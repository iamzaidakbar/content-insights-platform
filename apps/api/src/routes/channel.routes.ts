import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import type { PaginatedResult, SavedSearchWithViewerState } from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { success } from '../lib/response.js';
import {
  OWNER_POPULATE,
  isSavedSearchVisible,
  openChannel,
  resolveVisibleSavedSearches,
  toChannelDTOs,
  type PopulatedOwner,
  type PopulatedSavedSearchDoc,
} from '../lib/savedSearch.service.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { validate } from '../middleware/validate.js';
import { SavedSearchModel } from '../models/savedSearch.model.js';

export const channelRouter = express.Router();

const PAGE_SIZE = 20;

// No canonical shared validator exists for channel listing (packages/shared's
// saved-search.schema.ts covers SavedSearch CRUD only) — these are local to this route.
const listChannelsQuerySchema = z.object({
  groupId: z.string().min(1).optional(),
  sort: z.enum(['lastViewed_desc', 'lastViewed_asc']).default('lastViewed_desc'),
  type: z.enum(['dynamic', 'snapshot']).optional(),
  page: z.coerce.number().int().min(1).optional(),
});
type ListChannelsQuery = z.infer<typeof listChannelsQuerySchema>;

// GET / — every channel (isChannel: true) visible to the caller per
// resolveVisibleSavedSearches, enriched with this viewer's own ChannelView-derived state.
// Note: exposing a saved search as a channel does NOT by itself expand who can see it — see
// resolveVisibleSavedSearches's own comment. A channel only becomes visible to someone new
// via being shared into their group (POST /:id/share on savedSearch.routes.ts), being owned
// by them, falling under a group they administer, or being the current group's default.
channelRouter.get(
  '/',
  authenticate,
  orgContext,
  validate({ query: listChannelsQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { groupId, sort, type, page = 1 } = req.query as unknown as ListChannelsQuery;
    if (groupId && !mongoose.isValidObjectId(groupId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'groupId must be a valid id');
    }

    const visibility = await resolveVisibleSavedSearches(req.user, groupId ?? null);
    const filter: Record<string, unknown> = {
      ...visibility,
      isActive: true,
      isChannel: true,
      ...(type ? { type } : {}),
    };

    const docs = await SavedSearchModel.find(filter).populate<{ ownerId: PopulatedOwner }>(OWNER_POPULATE);
    const dtos = await toChannelDTOs(docs as PopulatedSavedSearchDoc[], req.user.id);

    // lastViewed is a per-viewer (ChannelView) value, not a SavedSearch column, so
    // sort/pagination happens in memory after viewer-state resolution rather than in the
    // Mongo query itself. Never-viewed channels sort to the very end regardless of
    // direction — "never viewed" isn't meaningfully "oldest" or "newest."
    const sorted = [...dtos].sort((a, b) => {
      const aTime = a.viewerState.lastViewedAt ? new Date(a.viewerState.lastViewedAt).getTime() : null;
      const bTime = b.viewerState.lastViewedAt ? new Date(b.viewerState.lastViewedAt).getTime() : null;
      if (aTime === null && bTime === null) return 0;
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      return sort === 'lastViewed_asc' ? aTime - bTime : bTime - aTime;
    });

    const total = sorted.length;
    const start = (page - 1) * PAGE_SIZE;
    const items = sorted.slice(start, start + PAGE_SIZE);

    const result: PaginatedResult<SavedSearchWithViewerState> = {
      items,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };
    res.status(200).json(success(result));
  }),
);

// GET /:id/open — the "open channel" action: for dynamic, the filters to run; for
// snapshot, the frozen locationHash-based article set. Always upserts this viewer's
// ChannelView (lastViewedAt: now), clearing their "new" badge, regardless of type.
channelRouter.get(
  '/:id/open',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Channel not found or access denied', 'CHANNEL_NOT_FOUND');

    const doc = await SavedSearchModel.findOne({ _id: id, orgId: req.user.orgId, isActive: true, isChannel: true });
    if (!doc) {
      throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found or access denied');
    }
    // Same "don't leak unauthorized vs. missing" treatment as GET /:id below.
    if (!(await isSavedSearchVisible(req.user, doc))) {
      throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found or access denied');
    }

    const opened = await openChannel(doc, req.user.id);

    // `opened` already carries `type` (it's a discriminated union on that field) — don't
    // repeat it here, or the literal would silently win over the real value.
    res.status(200).json(
      success({
        id: doc._id.toString(),
        name: doc.name,
        ...opened,
      }),
    );
  }),
);

// GET /:id — if the channel doesn't exist OR the caller lacks visibility into it, this
// returns the exact same generic 404 either way. Deliberately never distinguishes
// "doesn't exist" from "exists but you're not authorized" — see the brief's "Access denied
// if link target invisible (friendly message; do not leak unauthorized detail)."
channelRouter.get(
  '/:id',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Channel not found or access denied', 'CHANNEL_NOT_FOUND');

    // Fetched WITHOUT populate first — isSavedSearchVisible compares ownerId as a raw
    // ObjectId; populating it up front would silently break that `.toString()` comparison.
    const doc = await SavedSearchModel.findOne({ _id: id, orgId: req.user.orgId, isActive: true, isChannel: true });
    if (!doc) {
      throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found or access denied');
    }
    if (!(await isSavedSearchVisible(req.user, doc))) {
      throw new AppError(404, 'CHANNEL_NOT_FOUND', 'Channel not found or access denied');
    }

    const populated = await doc.populate<{ ownerId: PopulatedOwner }>(OWNER_POPULATE);
    const [dto] = await toChannelDTOs([populated as PopulatedSavedSearchDoc], req.user.id);
    res.status(200).json(success(dto));
  }),
);
