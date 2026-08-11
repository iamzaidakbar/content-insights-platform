import express from 'express';
import mongoose from 'mongoose';

import {
  createSavedSearchSchema,
  listSavedSearchesQuerySchema,
  runSavedSearchSchema,
  setChannelSchema,
  shareSavedSearchSchema,
  updateSavedSearchSchema,
  type CreateSavedSearchInput,
  type FilterPanelState,
  type ListSavedSearchesQuery,
  type PaginatedResult,
  type Permission,
  type RunSavedSearchInput,
  type SavedSearch,
  type SetChannelInput,
  type ShareSavedSearchInput,
  type UpdateSavedSearchInput,
} from '@content-insights/shared';

import { audit } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ConflictError, ForbiddenError, ValidationError } from '../lib/errors.js';
import { groupIdFromBody, hasGroupPermission } from '../lib/group-scope.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { success } from '../lib/response.js';
import {
  OWNER_POPULATE,
  createSavedSearch,
  fetchArticlesByLocationHashes,
  isSavedSearchVisible,
  loadSavedSearch,
  markSavedSearchAsRun,
  resolveVisibleSavedSearches,
  runSavedSearchQuery,
  toSavedSearchDTO,
  toSavedSearchDTOs,
  updateSavedSearch,
  type PopulatedOwner,
  type PopulatedSavedSearchDoc,
} from '../lib/savedSearch.service.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requireScopedPermission } from '../middleware/requireScopedPermission.js';
import { validate } from '../middleware/validate.js';
import { GroupModel } from '../models/group.model.js';
import { GroupDefaultQueryModel } from '../models/groupDefaultQuery.model.js';
import { SavedSearchModel, type SavedSearchDocument } from '../models/savedSearch.model.js';

export const savedSearchRouter = express.Router();

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------------------
// Access helpers — every route below authorizes via these (never a plain requirePermission
// flat-array check), because 'saved-searches:manage'/'manageAll'/etc. are typically held
// *scoped* to a Group (via a roleAssignment's groupId), not org-wide. Mirrors the
// established pattern elsewhere in this codebase (document.routes.ts, search.routes.ts,
// dashboard.routes.ts) for the identical reason.
// ---------------------------------------------------------------------------------------

// Visibility check for read-only actions (GET /:id, /:id/export, /:id/run) — isSavedSearchVisible
// (not resolveVisibleSavedSearches re-applied to this doc's own groupId — see that
// function's own comment for why that substitution would be wrong whenever a search has
// been shared into a group OTHER than the one it was created under).
async function assertCanView(req: express.Request, doc: SavedSearchDocument): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
  }
  if (!(await isSavedSearchVisible(req.user, doc))) {
    throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
  }
}

async function assertGroupPermission(
  req: express.Request,
  permissionKey: Permission,
  groupId: string,
): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
  }
  const allowed = await hasGroupPermission(req.user, permissionKey, groupId);
  if (!allowed) {
    throw new ForbiddenError(`Missing required permission: ${permissionKey}`);
  }
}

// The owner needs 'saved-searches:manage' on the search's own group; a non-owner needs the
// broader 'saved-searches:manageAll' (the Application Admin / User Group Admin tiers).
// Falls back to assertCanView purely to decide 404-vs-403 (never to grant access itself) —
// a non-owner who can't even SEE this saved search gets the same 404 as one that doesn't
// exist; a non-owner who can see it (e.g. it's a channel shared into their group) but lacks
// manageAll gets a real 403, since its existence is already legitimate knowledge for them.
async function assertCanManage(req: express.Request, doc: SavedSearchDocument): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
  }
  const isOwner = doc.ownerId.toString() === req.user.id;
  const permissionKey: Permission = isOwner ? 'saved-searches:manage' : 'saved-searches:manageAll';
  const allowed = await hasGroupPermission(req.user, permissionKey, doc.groupId.toString());
  if (allowed) return;

  await assertCanView(req, doc);
  throw new ForbiddenError(`Missing required permission: ${permissionKey}`);
}

async function populateOwner(doc: SavedSearchDocument): Promise<PopulatedSavedSearchDoc> {
  const populated = await doc.populate<{ ownerId: PopulatedOwner }>(OWNER_POPULATE);
  return populated as PopulatedSavedSearchDoc;
}

// ---------------------------------------------------------------------------------------
// POST / — create. Requires the caller's CURRENT navbar groupId (the canonical
// createSavedSearchSchema carries it as a required `groupId` body field — the JWT-derived
// AuthenticatedUser doesn't expose currentGroupId, so the body field is the only option
// that both matches the shared contract and lets requireScopedPermission validate it's a
// group the caller actually holds 'saved-searches:manage' in below). `filters.projectIds`
// may be `[]` ("all accessible at runtime" — see FilterPanelState's own doc comment) and is
// stored exactly as given, never expanded to a concrete project list at save time.
// ---------------------------------------------------------------------------------------
savedSearchRouter.post(
  '/',
  authenticate,
  orgContext,
  validate({ body: createSavedSearchSchema }),
  requireScopedPermission('saved-searches:manage' satisfies Permission, groupIdFromBody('groupId')),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { groupId, name, type, filters } = req.body as CreateSavedSearchInput;
    if (!mongoose.isValidObjectId(groupId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'groupId must be a valid id');
    }

    const doc = await createSavedSearch({
      orgId: req.user.orgId,
      groupId,
      ownerId: req.user.id,
      name,
      type,
      // The zod-inferred FilterPanelStateInput and the hand-authored FilterPanelState are
      // the same validated shape, but zod's `.nullable().optional()` fields infer as
      // `T | null | undefined` while FilterPanelState declares `T | null` — a value-level
      // widening that trips `exactOptionalPropertyTypes` on straight assignment even though
      // the runtime shapes are identical post-validation.
      filters: filters as FilterPanelState,
    });

    audit(req, {
      action: 'saved-search.create',
      entityType: 'saved-search',
      entityId: doc._id.toString(),
      groupId,
      details: { name, type },
    });

    res.status(201).json(success(await toSavedSearchDTO(await populateOwner(doc))));
  }),
);

// GET / — list. resolveVisibleSavedSearches IS the complete authorization decision here
// (own + admin tiers + the current group's default + anything explicitly shared into the
// current group) — same philosophy as search.routes.ts's resolveDocumentScope-is-the-
// decision comment, no separate flat requirePermission gate on top.
savedSearchRouter.get(
  '/',
  authenticate,
  orgContext,
  validate({ query: listSavedSearchesQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { scope, groupId, page = 1 } = req.query as unknown as ListSavedSearchesQuery;
    if (groupId && !mongoose.isValidObjectId(groupId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'groupId must be a valid id');
    }

    const visibility = await resolveVisibleSavedSearches(req.user, groupId ?? null);
    const filter: Record<string, unknown> = {
      ...visibility,
      isActive: true,
      ...(scope === 'channels' ? { isChannel: true } : {}),
    };

    const [docs, total] = await Promise.all([
      SavedSearchModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .populate<{ ownerId: PopulatedOwner }>(OWNER_POPULATE),
      SavedSearchModel.countDocuments(filter),
    ]);

    const items = await toSavedSearchDTOs(docs as PopulatedSavedSearchDoc[]);
    const result: PaginatedResult<SavedSearch> = {
      items,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };
    res.status(200).json(success(result));
  }),
);

// GET /:id — load/rehydrate. For a dynamic saved search this is just its stored
// FilterPanelState handed back unchanged (relative dates recalculate later, at actual
// query time — see loadSavedSearch's own comment); for a snapshot, the "search" IS its
// frozen locationHash-matched article set. Loading also marks lastRunAt (same bookkeeping
// as POST /:id/run) so the Saved Searches "Last run" column updates when someone Loads.
savedSearchRouter.get(
  '/:id',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Saved search not found', 'SAVED_SEARCH_NOT_FOUND');

    const doc = await SavedSearchModel.findOne({ _id: id, orgId: req.user.orgId, isActive: true });
    if (!doc) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
    }
    await assertCanView(req, doc);

    const loaded = loadSavedSearch(doc);
    const result =
      loaded.type === 'snapshot'
        ? { ...loaded, ...(await fetchArticlesByLocationHashes(doc.orgId.toString(), loaded.locationHashes)) }
        : loaded;

    await markSavedSearchAsRun(doc, new Date());

    res.status(200).json(success({ savedSearch: await toSavedSearchDTO(await populateOwner(doc)), result }));
  }),
);

// PUT /:id — rename and/or update filters. Re-validates the name-uniqueness rule the same
// way as create (see updateSavedSearch). For a `type: 'snapshot'` saved search, including
// `filters` in the payload IS what triggers re-validating the snapshot cap/missing-hash
// rules and recapturing snapshotLocationHashes — see updateSavedSearch's own comment for
// why (the canonical updateSavedSearchSchema has no separate "resnapshot" flag to check
// instead). A rename-only PUT (filters omitted) never touches the frozen snapshot.
savedSearchRouter.put(
  '/:id',
  authenticate,
  orgContext,
  validate({ body: updateSavedSearchSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Saved search not found', 'SAVED_SEARCH_NOT_FOUND');

    const doc = await SavedSearchModel.findOne({ _id: id, orgId: req.user.orgId, isActive: true });
    if (!doc) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
    }
    await assertCanManage(req, doc);

    const body = req.body as UpdateSavedSearchInput;
    // Rebuilt (rather than passed straight through) for two reasons: (1) omit a key
    // entirely instead of assigning `undefined` — zod's optional inference widens to
    // `T | undefined` even under `exactOptionalPropertyTypes`, which the hand-authored
    // UpdateSavedSearchParams (deliberately `name?: string`, no `| undefined`) rejects on
    // straight assignment; (2) the same FilterPanelStateInput-vs-FilterPanelState value
    // widening as POST / above applies to `filters` too.
    const updated = await updateSavedSearch(doc, new Date(), {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.filters !== undefined ? { filters: body.filters as FilterPanelState } : {}),
    });

    audit(req, {
      action: 'saved-search.update',
      entityType: 'saved-search',
      entityId: id,
      groupId: doc.groupId.toString(),
      details: { updatedFields: Object.keys(body) },
    });

    res.status(200).json(success(await toSavedSearchDTO(await populateOwner(updated))));
  }),
);

// DELETE /:id — soft delete (isActive: false), which frees the name back up via the
// partial unique index. Rejected outright if a GroupDefaultQuery still points at this
// saved search ("Default group query cannot be deleted while it remains the default").
savedSearchRouter.delete(
  '/:id',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Saved search not found', 'SAVED_SEARCH_NOT_FOUND');

    const doc = await SavedSearchModel.findOne({ _id: id, orgId: req.user.orgId, isActive: true });
    if (!doc) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
    }
    await assertCanManage(req, doc);

    const stillDefault = await GroupDefaultQueryModel.exists({ savedSearchId: id });
    if (stillDefault) {
      throw new ConflictError(
        'Default group query cannot be deleted while it remains the default',
        'SAVED_SEARCH_IS_DEFAULT',
      );
    }

    doc.isActive = false;
    await doc.save();

    audit(req, {
      action: 'saved-search.delete',
      entityType: 'saved-search',
      entityId: id,
      groupId: doc.groupId.toString(),
      details: { name: doc.name },
    });
    res.status(200).json(success(null));
  }),
);

// POST /:id/share — appends groupIds to sharedWithGroups. This is the ONLY action that
// expands a saved search's visibility beyond its base owner/admin-tier/current-group-
// default rules (see resolveVisibleSavedSearches) — exposing it as a channel
// (isChannel: true, below) never does, on its own, grant anyone new visibility into it.
savedSearchRouter.post(
  '/:id/share',
  authenticate,
  orgContext,
  validate({ body: shareSavedSearchSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Saved search not found', 'SAVED_SEARCH_NOT_FOUND');

    const doc = await SavedSearchModel.findOne({ _id: id, orgId: req.user.orgId, isActive: true });
    if (!doc) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
    }
    await assertCanView(req, doc);
    await assertGroupPermission(req, 'saved-searches:shareIntoGroups' satisfies Permission, doc.groupId.toString());

    const { groupIds } = req.body as ShareSavedSearchInput;
    const invalidId = groupIds.find((gid) => !mongoose.isValidObjectId(gid));
    if (invalidId) {
      throw new ValidationError('groupIds must all be valid ids');
    }
    const foundGroups = await GroupModel.find({ _id: { $in: groupIds }, orgId: req.user.orgId }, { _id: 1 });
    if (foundGroups.length !== new Set(groupIds).size) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'One or more groups were not found');
    }

    const alreadyShared = new Set(doc.sharedWithGroups.map((grant) => grant.groupId.toString()));
    const newGroupIds = groupIds.filter((gid) => !alreadyShared.has(gid));
    if (newGroupIds.length > 0) {
      doc.sharedWithGroups.push(...newGroupIds.map((gid) => ({ groupId: new mongoose.Types.ObjectId(gid) })));
      await doc.save();
    }

    audit(req, {
      action: 'saved-search.share',
      entityType: 'saved-search',
      entityId: id,
      groupId: doc.groupId.toString(),
      details: { sharedWith: groupIds },
    });

    res.status(200).json(success(await toSavedSearchDTO(await populateOwner(doc))));
  }),
);

// DELETE /:id/share/:groupId — revoke a share grant.
savedSearchRouter.delete(
  '/:id/share/:groupId',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Saved search not found', 'SAVED_SEARCH_NOT_FOUND');
    const targetGroupId = parseObjectIdParam(
      req.params.groupId,
      'Share grant not found',
      'SAVED_SEARCH_SHARE_NOT_FOUND',
    );

    const doc = await SavedSearchModel.findOne({ _id: id, orgId: req.user.orgId, isActive: true });
    if (!doc) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
    }
    await assertCanView(req, doc);
    await assertGroupPermission(req, 'saved-searches:shareIntoGroups' satisfies Permission, doc.groupId.toString());

    const before = doc.sharedWithGroups.length;
    doc.sharedWithGroups = doc.sharedWithGroups.filter((grant) => grant.groupId.toString() !== targetGroupId);
    if (doc.sharedWithGroups.length === before) {
      throw new AppError(404, 'SAVED_SEARCH_SHARE_NOT_FOUND', 'Share grant not found');
    }
    await doc.save();

    audit(req, {
      action: 'saved-search.share',
      entityType: 'saved-search',
      entityId: id,
      groupId: doc.groupId.toString(),
      details: { revoked: targetGroupId },
    });

    res.status(200).json(success(await toSavedSearchDTO(await populateOwner(doc))));
  }),
);

// POST /:id/expose-channel — sets isChannel: true (+ channelName). Requires the caller to
// explicitly send `isChannel: true` (the canonical setChannelSchema's own superRefine then
// requires channelName alongside it) — the endpoint path decides direction, but the body is
// still validated against the exact shared contract rather than a bespoke one.
savedSearchRouter.post(
  '/:id/expose-channel',
  authenticate,
  orgContext,
  validate({ body: setChannelSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const body = req.body as SetChannelInput;
    if (!body.isChannel) {
      throw new ValidationError('isChannel must be true for expose-channel');
    }
    const id = parseObjectIdParam(req.params.id, 'Saved search not found', 'SAVED_SEARCH_NOT_FOUND');

    const doc = await SavedSearchModel.findOne({ _id: id, orgId: req.user.orgId, isActive: true });
    if (!doc) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
    }
    await assertCanView(req, doc);
    await assertGroupPermission(req, 'saved-searches:publish' satisfies Permission, doc.groupId.toString());

    doc.isChannel = true;
    doc.channelName = body.channelName ?? null;
    await doc.save();

    audit(req, {
      action: 'channel.expose',
      entityType: 'saved-search',
      entityId: id,
      groupId: doc.groupId.toString(),
      details: { channelName: doc.channelName },
    });

    res.status(200).json(success(await toSavedSearchDTO(await populateOwner(doc))));
  }),
);

// POST /:id/demote-channel — reverses expose-channel. lastRunAt/newResultsCount are
// deliberately left alone (cheap history, clean re-promote later), same as channelName
// being cleared and simply re-set on a future re-promotion.
savedSearchRouter.post(
  '/:id/demote-channel',
  authenticate,
  orgContext,
  validate({ body: setChannelSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const body = req.body as SetChannelInput;
    if (body.isChannel) {
      throw new ValidationError('isChannel must be false for demote-channel');
    }
    const id = parseObjectIdParam(req.params.id, 'Saved search not found', 'SAVED_SEARCH_NOT_FOUND');

    const doc = await SavedSearchModel.findOne({ _id: id, orgId: req.user.orgId, isActive: true });
    if (!doc) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
    }
    await assertCanView(req, doc);
    await assertGroupPermission(req, 'saved-searches:publish' satisfies Permission, doc.groupId.toString());

    doc.isChannel = false;
    doc.channelName = null;
    await doc.save();

    audit(req, {
      action: 'channel.demote',
      entityType: 'saved-search',
      entityId: id,
      groupId: doc.groupId.toString(),
      details: {},
    });

    res.status(200).json(success(await toSavedSearchDTO(await populateOwner(doc))));
  }),
);

// POST /:id/run — marks lastRunAt (+ refreshes newResultsCount), the "mark-as-run" for
// channel new-articles semantics, and also actually executes the query (matching the
// canonical runSavedSearchSchema's page/size params) so a caller gets fresh results back
// in the same round-trip.
savedSearchRouter.post(
  '/:id/run',
  authenticate,
  orgContext,
  validate({ body: runSavedSearchSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Saved search not found', 'SAVED_SEARCH_NOT_FOUND');

    const doc = await SavedSearchModel.findOne({ _id: id, orgId: req.user.orgId, isActive: true });
    if (!doc) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
    }
    await assertCanView(req, doc);

    const { page, size } = req.body as RunSavedSearchInput;
    const now = new Date();
    const results = await runSavedSearchQuery(doc, page, size, now);
    await markSavedSearchAsRun(doc, now);

    res.status(200).json(success({ savedSearch: await toSavedSearchDTO(await populateOwner(doc)), results }));
  }),
);

// GET /:id/export — the query DEFINITION (filters, not a re-run of results).
savedSearchRouter.get(
  '/:id/export',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Saved search not found', 'SAVED_SEARCH_NOT_FOUND');

    const doc = await SavedSearchModel.findOne({ _id: id, orgId: req.user.orgId, isActive: true });
    if (!doc) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
    }
    await assertCanView(req, doc);

    res.status(200).json(
      success({
        id: doc._id.toString(),
        name: doc.name,
        type: doc.type,
        filters: doc.filters,
        ...(doc.type === 'snapshot'
          ? { snapshotArticleCount: doc.snapshotLocationHashes.length, snapshotLocationHashes: doc.snapshotLocationHashes }
          : {}),
        exportedAt: new Date().toISOString(),
      }),
    );
  }),
);
