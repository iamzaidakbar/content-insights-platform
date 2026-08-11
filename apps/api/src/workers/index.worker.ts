import type { Job, Worker as BullWorker } from 'bullmq';

import { indexArticle } from '../lib/elasticsearch.js';
import { logger } from '../lib/logger.js';
import { ARTICLE_INDEX_QUEUE, redisConnection, Worker } from '../lib/queue.js';
import { ArticleModel } from '../models/article.model.js';

// The consumer side of articleIngestQueue's ingest -> index handoff (see
// ingest.worker.ts's own comment for the two paths that enqueue here: admin-triggered File
// System re-extraction, and the simulated NEWS fixture ingesting directly via indexArticle
// without going through this queue at all — this worker exists for the retry-safe
// background path, not as the only way an Article ever reaches Elasticsearch).
interface IndexJobData {
  articleId: string;
  orgId: string;
}

async function processIndexJob(job: Job<IndexJobData>): Promise<void> {
  const { articleId } = job.data;

  const article = await ArticleModel.findById(articleId); // fresh lookup, same as ingest.worker.ts
  if (!article) {
    return; // deleted or bogus id — nothing to do, don't retry
  }

  await indexArticle({
    id: article._id.toString(),
    orgId: article.orgId.toString(),
    projectId: article.projectId.toString(),
    title: article.title,
    summary: article.summary,
    body: article.body,
    domain: article.domain,
    sourceType: article.sourceType,
    publishedAt: article.publishedAt.toISOString(),
    authors: article.authors,
    taxonomyValues: article.taxonomyValues,
    tagIds: article.tagIds.map((id) => id.toString()),
    locationHash: article.locationHash,
    hidden: article.hidden,
    createdAt: article.createdAt.toISOString(),
  });
}

// In-process, same as startIngestWorker — fine at this scope.
export function startIndexWorker(): BullWorker<IndexJobData> {
  const worker = new Worker<IndexJobData>(ARTICLE_INDEX_QUEUE, processIndexJob, {
    connection: redisConnection,
  });
  worker.on('failed', (job, err) => {
    logger.warn(
      { articleId: job?.data.articleId, attemptsMade: job?.attemptsMade, err: err.message },
      'Article index job attempt failed',
    );
  });
  return worker;
}
