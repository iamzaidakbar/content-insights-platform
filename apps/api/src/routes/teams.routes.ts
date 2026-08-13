// No live MS Graph credentials are configured in this environment, so POST /share below
// does not call out to the real Microsoft Teams API — there's simply nothing to
// authenticate a Graph call with. Instead it records what WOULD have been shared (message,
// mentions, article count) as a TeamsShareRecord with simulated: true, so the sharing UI
// and its history view are fully exercisable end-to-end. Swap the body of the handler
// below for a real Graph API call (e.g. POST to a channel's /messages endpoint) once OAuth
// credentials are available — TeamsShareRecord's shape doesn't need to change.
import express from 'express';

import {
  DEFAULT_TEAMS_MAX_ARTICLES_PER_SHARE,
  teamsShareRequestSchema,
  type Permission,
  type TeamsShareRequestInput,
} from '@content-insights/shared';

import { audit } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ValidationError } from '../lib/errors.js';
import { success } from '../lib/response.js';
import { toTeamsShareDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { GlobalSettingsModel } from '../models/globalSettings.model.js';
import { TeamsShareModel } from '../models/teamsShare.model.js';

export const teamsRouter = express.Router();

// Applied on top of teamsShareRequestSchema's own generous 2000-char sanity ceiling (see
// teams.schema.ts) — 1000 chars is a practical hard cap for a bulk MS Teams message:
// beyond that, Teams' message/adaptive-card rendering starts truncating or collapsing the
// text in most clients, so a longer message wouldn't actually reach recipients intact.
const MAX_MESSAGE_LENGTH = 1000;

// GlobalSettings.msTeams.maxArticlesPerShare, defaulting the same way getMaxSnapshotArticles
// does in savedSearch.service.ts for the analogous maxSnapshotArticles setting — an org that
// has never touched its GlobalSettings still gets a sane bulk-share cap rather than an
// unbounded one.
async function getMaxArticlesPerShare(orgId: string): Promise<number> {
  const settings = await GlobalSettingsModel.findOne({ orgId }, { 'msTeams.maxArticlesPerShare': 1 });
  return settings?.msTeams.maxArticlesPerShare ?? DEFAULT_TEAMS_MAX_ARTICLES_PER_SHARE;
}

teamsRouter.post(
  '/share',
  authenticate,
  orgContext,
  requirePermission('ms-teams:share' satisfies Permission),
  validate({ body: teamsShareRequestSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const body = req.body as TeamsShareRequestInput;

    if (body.message.length > MAX_MESSAGE_LENGTH) {
      throw new ValidationError(
        `Message is ${body.message.length} characters, which exceeds the ${MAX_MESSAGE_LENGTH}-character limit for a Teams share`,
        undefined,
        'TEAMS_MESSAGE_TOO_LONG',
      );
    }

    // teamsShareRequestSchema already hard-caps articles at DEFAULT_TEAMS_MAX_ARTICLES_PER_SHARE
    // as an outer sanity ceiling (see its own comment) — this enforces the org's own
    // (potentially tighter) configured limit on top of that.
    const maxArticlesPerShare = await getMaxArticlesPerShare(req.user.orgId);
    if (body.articles.length > maxArticlesPerShare) {
      throw new ValidationError(
        `This share includes ${body.articles.length} articles, which exceeds the maximum of ${maxArticlesPerShare} articles allowed per Teams share`,
        undefined,
        'TEAMS_SHARE_LIMIT_EXCEEDED',
      );
    }

    // Simulated — see the module comment above. Nothing is actually posted to MS Teams;
    // article titles/urls/useAppDeepLink aren't persisted, only the aggregate count,
    // matching TeamsShareRecord's shape (see teams.ts's own comment on why).
    const share = await TeamsShareModel.create({
      orgId: req.user.orgId,
      sharedBy: req.user.id,
      message: body.message,
      mentions: body.mentions,
      articleCount: body.articles.length,
      simulated: true,
    });

    audit(req, {
      action: 'ms-teams.share',
      // No dedicated 'ms-teams'/'teams-share' AuditEntityType exists — filed under
      // 'organization', same as global-settings.update, since this is an org-wide sharing
      // action rather than a mutation of one specific article/project/concept record.
      entityType: 'organization',
      entityId: req.user.orgId,
      details: {
        teamsShareId: share._id.toString(),
        articleCount: body.articles.length,
        mentionCount: body.mentions.length,
        useAppDeepLink: body.useAppDeepLink,
      },
    });

    res.status(201).json(success(toTeamsShareDTO(share)));
  }),
);

teamsRouter.get(
  '/shares',
  authenticate,
  orgContext,
  requirePermission('ms-teams:share' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = 20;
    const filter = { orgId: req.user.orgId, sharedBy: req.user.id };
    const [items, total] = await Promise.all([
      TeamsShareModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      TeamsShareModel.countDocuments(filter),
    ]);
    res.status(200).json(
      success({
        items: items.map(toTeamsShareDTO),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      }),
    );
  }),
);
