import express from 'express';

import type { Permission } from '@content-insights/shared';

import { audit } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { articleIndexQueue, articleIngestQueue } from '../lib/queue.js';
import { success } from '../lib/response.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { ArticleModel } from '../models/article.model.js';

export const adminRouter = express.Router();

// Re-syncs every live article in the org to Elasticsearch. Used after a mapping change or
// to backfill fields added since articles were indexed. Queue-backed, so the request
// returns immediately.
//
// File System articles are re-extracted from their stored asset before being re-indexed
// (see ingest.worker.ts's own comment on why that path exists as a queue rather than being
// inline here); NEWS articles have no extractable source file to re-run — their `body` is
// already the ingested content — so they skip straight to the index queue.
adminRouter.post(
  '/reindex',
  authenticate,
  orgContext,
  requirePermission('org:admin' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const orgId = req.user.orgId;

    const articles = await ArticleModel.find({ orgId }, { _id: 1, sourceType: 1 });
    const fileSystemArticles = articles.filter((article) => article.sourceType === 'file_system');
    const newsArticles = articles.filter((article) => article.sourceType === 'news');

    await articleIngestQueue.addBulk(
      fileSystemArticles.map((article) => ({
        name: 'ingest',
        data: { articleId: article._id.toString() },
      })),
    );
    await articleIndexQueue.addBulk(
      newsArticles.map((article) => ({
        name: 'index',
        data: { articleId: article._id.toString(), orgId },
      })),
    );

    audit(req, {
      action: 'admin.reindex',
      entityType: 'organization',
      entityId: orgId,
      details: { articleCount: articles.length },
    });

    res.status(202).json(success({ queued: articles.length }));
  }),
);
