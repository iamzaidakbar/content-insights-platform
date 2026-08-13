import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import {
  createUserTagSchema,
  shareUserTagSchema,
  updateUserTagSchema,
  type BulkOperationItemResult,
  type BulkOperationResult,
  type CreateUserTagInput,
  type Permission,
  type ShareUserTagInput,
  type UpdateUserTagInput,
  type UserTag,
} from '@content-insights/shared';
import { asGroupId, asOrgId, asUserId, asUserTagId } from '@content-insights/shared';

import { resolveArticleSearchGrants } from '../lib/article-access.js';
import { audit } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { bulkIndexArticles, toIndexArticleParams } from '../lib/elasticsearch.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError, isDuplicateKeyError } from '../lib/errors.js';
import { hasGroupPermission, resolveDocumentScope } from '../lib/group-scope.js';
import { logger } from '../lib/logger.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { isRoleAssignmentActive } from '../lib/permissions.js';
import { success } from '../lib/response.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { validate } from '../middleware/validate.js';
import { ArticleModel } from '../models/article.model.js';
import { GroupModel } from '../models/group.model.js';
import { UserModel } from '../models/user.model.js';
import { UserTagModel, type UserTagDocument } from '../models/userTag.model.js';
import type { AuthenticatedUser } from '../types/express.js';

export const userTagRouter = express.Router();

// ===========================================================================================
// Hard business rule: "Private tags never leak via free-text, exports, or shared views."
//
// A private tag (isPrivate: true) is visible/attachable only to members of its ownerGroupId,
// or an org admin (globalPermissions holds '*' or 'org:admin' — see isOrgAdmin below). This
// file is the single place that enforces it:
//   - GET / never queries a private tag whose ownerGroupId isn't one of the caller's groups
//     (isOrgAdmin bypasses the filter entirely).
//   - resolveVisibleUserTagsForArticle (exported for Article-serialization routes to use once
//     they resolve an Article's tagIds to display names) applies the identical filter and
//     silently DROPS any tag the viewer can't see, rather than returning a redacted
//     placeholder. Omission was chosen over a placeholder because a placeholder ("Private
//     tag") still discloses to an outside viewer that a hidden tag exists on that article —
//     a smaller but real leak; full omission discloses nothing extra beyond what the viewer
//     could already see.
//   - The Elasticsearch Article index (lib/elasticsearch.ts) only ever stores raw tagIds as
//     opaque keyword values for faceting, never a tag's name, so the free-text index has no
//     name to leak in the first place — but any future export/report code that resolves a
//     tagId to a display name MUST route through resolveVisibleUserTagsForArticle (or
//     duplicate its filter) rather than reading UserTagModel directly, or that guarantee
//     breaks.
// ===========================================================================================

function isOrgAdmin(user: AuthenticatedUser): boolean {
  return user.globalPermissions.includes('*') || user.globalPermissions.includes('org:admin' satisfies Permission);
}

// "Member of a group" = holds at least one currently-active roleAssignment scoped to it —
// same derivation Group.members itself uses (see group.model.ts's own comment), just kept
// as a Set of ids here rather than resolved into full GroupMember rows.
function activeGroupIds(user: AuthenticatedUser, now = new Date()): Set<string> {
  const ids = new Set<string>();
  for (const assignment of user.roleAssignments) {
    if (assignment.groupId && isRoleAssignmentActive(assignment, now)) {
      ids.add(assignment.groupId);
    }
  }
  return ids;
}

// A resource-scoped permission check: org-wide holders of `permissionKey` (or an org admin)
// pass unconditionally; everyone else needs `permissionKey` specifically on `groupId`.
async function assertGroupScopedPermission(
  user: AuthenticatedUser,
  permissionKey: Permission,
  groupId: string,
): Promise<void> {
  if (isOrgAdmin(user)) return;
  const allowed = await hasGroupPermission(user, permissionKey, groupId);
  if (!allowed) {
    throw new ForbiddenError(`Missing required permission: ${permissionKey}`);
  }
}

// Governs POST /bulk-apply (mode 'use') and POST /bulk-remove (mode 'delete') — this is the
// "CanUse permission check per tag" referenced by both routes' spec. Deliberately distinct
// from assertGroupScopedPermission/user-tags:manage on the tag ENTITY (rename/delete/share):
// using a tag to (de)tag articles is a lighter-weight capability that a share grant can also
// confer on a non-owner group, whereas the tag entity itself (PUT/DELETE /:id, and sharing it
// further) always stays owner-group-only — see the share-grant note in POST /:id/share.
async function assertCanUseOrRemoveTag(
  user: AuthenticatedUser,
  tag: UserTagDocument,
  mode: 'use' | 'delete',
): Promise<void> {
  if (isOrgAdmin(user)) return;

  // Owning the tag is a superset of any share grant — the owner group can always use AND
  // remove its own tag.
  if (await hasGroupPermission(user, 'user-tags:manage' satisfies Permission, tag.ownerGroupId.toString())) {
    return;
  }

  if (tag.isPrivate) {
    // Private tags are unusable outside the owner group unless explicitly shared in — the
    // "attachable only to members of the owner group [or a group it's shared with]" half of
    // the hard privacy rule. `canUse` gates bulk-apply, `canDelete` gates bulk-remove.
    for (const grant of tag.sharedWithGroups) {
      const grantAllows = mode === 'use' ? grant.canUse : grant.canDelete;
      if (grantAllows && (await hasGroupPermission(user, 'user-tags:manage' satisfies Permission, grant.groupId.toString()))) {
        return;
      }
    }
    throw new ForbiddenError('This tag is private to another group');
  }

  // Public (non-private) tags are shared org vocabulary: any holder of user-tags:manage
  // anywhere (org-wide or in at least one group) may attach/detach them, even without an
  // explicit share grant — share grants only matter for extending PRIVATE tags beyond their
  // owner group.
  const scope = await resolveDocumentScope(user, 'user-tags:manage' satisfies Permission);
  if (scope.orgWide || scope.allowedGroupIds.length > 0) return;
  throw new ForbiddenError('Missing required permission: user-tags:manage');
}

// ---------------------------------------------------------------------------------------
// Serialization — no shared lib/serializers.ts entry exists yet for UserTag, so this stays
// local to this route file. ownerGroupName/sharedWithGroups[].groupName are denormalizations
// the shared UserTag type expects but the Mongoose model doesn't store (see userTag.model.ts)
// — resolved here via a single batched Group lookup per response.
// ---------------------------------------------------------------------------------------

async function serializeUserTags(tags: UserTagDocument[]): Promise<UserTag[]> {
  const groupIds = new Set<string>();
  for (const tag of tags) {
    groupIds.add(tag.ownerGroupId.toString());
    for (const grant of tag.sharedWithGroups) {
      groupIds.add(grant.groupId.toString());
    }
  }
  const groups =
    groupIds.size > 0 ? await GroupModel.find({ _id: { $in: Array.from(groupIds) } }, { name: 1 }) : [];
  const groupNameById = new Map(groups.map((group) => [group._id.toString(), group.name]));

  // Live counts from Article.tagIds — UserTag.articleCount is a maintained counter that
  // can drift. The Tags page should show how many articles actually carry the tag.
  const liveCountByTagId = await liveArticleCountsByTagId(tags);

  return tags.map((tag) => ({
    id: asUserTagId(tag._id.toString()),
    orgId: asOrgId(tag.orgId.toString()),
    name: tag.name,
    ownerGroupId: asGroupId(tag.ownerGroupId.toString()),
    ownerGroupName: groupNameById.get(tag.ownerGroupId.toString()) ?? '',
    isPrivate: tag.isPrivate,
    isPublished: tag.isPublished,
    createdBy: asUserId(tag.createdBy.toString()),
    sharedWithGroups: tag.sharedWithGroups.map((grant) => ({
      groupId: asGroupId(grant.groupId.toString()),
      groupName: groupNameById.get(grant.groupId.toString()) ?? '',
      canUse: grant.canUse,
      canDelete: grant.canDelete,
    })),
    articleCount: liveCountByTagId.get(tag._id.toString()) ?? 0,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  }));
}

async function liveArticleCountsByTagId(tags: UserTagDocument[]): Promise<Map<string, number>> {
  const orgId = tags[0]?.orgId;
  if (!orgId) return new Map();
  const tagIds = tags.map((tag) => tag._id);
  const rows = await ArticleModel.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { orgId, tagIds: { $in: tagIds } } },
    { $unwind: '$tagIds' },
    { $match: { tagIds: { $in: tagIds } } },
    { $group: { _id: '$tagIds', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), row.count]));
}

async function serializeUserTag(tag: UserTagDocument): Promise<UserTag> {
  const [dto] = await serializeUserTags([tag]);
  return dto as UserTag;
}

/** Counts visible in Articles with every accessible project selected (exclude hidden, any time). */
async function searchScopedTagCounts(user: AuthenticatedUser, tags: UserTagDocument[]): Promise<Map<string, number>> {
  const orgId = tags[0]?.orgId;
  if (!orgId) return new Map();
  const tagIds = tags.map((tag) => tag._id);

  const match: Record<string, unknown> = { orgId, tagIds: { $in: tagIds }, hidden: false };
  try {
    const grants = await resolveArticleSearchGrants(user, 'articles:read' satisfies Permission);
    match.projectId = { $in: grants.projectIds.map((id) => new mongoose.Types.ObjectId(id)) };
  } catch {
    // No articles:read — still return org-wide non-hidden counts below.
  }

  const rows = await ArticleModel.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: match },
    { $unwind: '$tagIds' },
    { $match: { tagIds: { $in: tagIds } } },
    { $group: { _id: '$tagIds', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), row.count]));
}

// Exported for future Article-serialization routes (no article.routes.ts exists yet in this
// codebase) — resolves the subset of `tagIds` the given viewer may see, per the hard privacy
// rule documented at the top of this file. Any private tag the viewer can't see is silently
// dropped from the returned array, never replaced with a placeholder.
export async function resolveVisibleUserTagsForArticle(
  user: AuthenticatedUser,
  tagIds: Array<string | mongoose.Types.ObjectId>,
): Promise<UserTag[]> {
  if (tagIds.length === 0) return [];
  const tags = await UserTagModel.find({ orgId: user.orgId, _id: { $in: tagIds } });
  const admin = isOrgAdmin(user);
  const memberGroupIds = activeGroupIds(user);
  const visible = tags.filter(
    (tag) => !tag.isPrivate || admin || memberGroupIds.has(tag.ownerGroupId.toString()),
  );
  return serializeUserTags(visible);
}

// ---------------------------------------------------------------------------------------
// GET / — every public (non-private) tag in the org, plus private tags owned by one of the
// caller's own groups (or every private tag, for an org admin).
// ---------------------------------------------------------------------------------------
userTagRouter.get(
  '/',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const user = req.user;

    // Baseline feature gate, not a per-tag check: no plain requirePermission here (would
    // 403 a group-scoped-only reader) — mirrors document.routes.ts's GET / for the identical
    // reason.
    const scope = await resolveDocumentScope(user, 'user-tags:read' satisfies Permission);
    if (!scope.orgWide && scope.allowedGroupIds.length === 0) {
      res.status(200).json(success([] satisfies UserTag[]));
      return;
    }

    const privateFilter: Record<string, unknown> = { orgId: user.orgId, isPrivate: true };
    if (!isOrgAdmin(user)) {
      privateFilter.ownerGroupId = { $in: Array.from(activeGroupIds(user)) };
    }

    const [publicTags, privateTags] = await Promise.all([
      UserTagModel.find({ orgId: user.orgId, isPrivate: false }),
      UserTagModel.find(privateFilter),
    ]);

    const combined = [...publicTags, ...privateTags].sort((a, b) => a.name.localeCompare(b.name));
    const dtos = await serializeUserTags(combined);
    const scopedCounts = await searchScopedTagCounts(user, combined);
    const payload = dtos.map((tag) => ({ ...tag, articleCount: scopedCounts.get(tag.id) ?? 0 }));
    res.status(200).json(success(payload satisfies UserTag[]));
  }),
);

// ---------------------------------------------------------------------------------------
// POST / — create. ownerGroupId is always the creator's CURRENT group, never client-supplied
// (see createUserTagSchema's own comment) — fetched from the User document because
// currentGroupId is a "last-selected navbar group" preference (models/user.model.ts), not
// baked into the 15-minute access token the way roleAssignments' scope/time-bounds are.
// ---------------------------------------------------------------------------------------
userTagRouter.post(
  '/',
  authenticate,
  orgContext,
  validate({ body: createUserTagSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const actingUser = await UserModel.findById(req.user.id, { currentGroupId: 1 });
    if (!actingUser?.currentGroupId) {
      throw new AppError(400, 'NO_CURRENT_GROUP', 'Select a group before creating a tag');
    }
    const ownerGroupId = actingUser.currentGroupId;

    await assertGroupScopedPermission(req.user, 'user-tags:manage' satisfies Permission, ownerGroupId.toString());

    const { name, isPrivate } = req.body as CreateUserTagInput;

    try {
      const tag = await UserTagModel.create({
        orgId: req.user.orgId,
        name,
        // Lowercased mirror enforcing case-insensitive uniqueness — see userTag.model.ts's
        // own comment on `normalizedName`. No Mongoose hook maintains it; every write path
        // in this file (here and PUT /:id) is responsible for keeping it in sync with `name`.
        normalizedName: name.toLowerCase(),
        ownerGroupId,
        isPrivate,
        isPublished: false,
        createdBy: req.user.id,
        sharedWithGroups: [],
        articleCount: 0,
      });

      audit(req, {
        action: 'user-tag.create',
        entityType: 'user-tag',
        entityId: tag._id.toString(),
        groupId: ownerGroupId.toString(),
        details: { name: tag.name, isPrivate: tag.isPrivate },
      });

      res.status(201).json(success(await serializeUserTag(tag)));
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('A tag with this name already exists', 'USER_TAG_NAME_TAKEN');
      }
      throw err;
    }
  }),
);

// ---------------------------------------------------------------------------------------
// PUT /:id — rename and/or toggle privacy. Note: the canonical validator's own comment
// (user-tag.schema.ts) says "PATCH /api/user-tags/:id"; this route is implemented as PUT per
// this feature's explicit routing spec. The request body shape (updateUserTagSchema) is
// identical either way, so wiring a client to PATCH instead is a one-line change if needed.
// ---------------------------------------------------------------------------------------
userTagRouter.put(
  '/:id',
  authenticate,
  orgContext,
  validate({ body: updateUserTagSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User tag not found', 'USER_TAG_NOT_FOUND');
    const tag = await UserTagModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!tag) {
      throw new NotFoundError('User tag not found', 'USER_TAG_NOT_FOUND');
    }

    await assertGroupScopedPermission(req.user, 'user-tags:manage' satisfies Permission, tag.ownerGroupId.toString());

    const body = req.body as UpdateUserTagInput;
    if (body.name !== undefined) {
      tag.name = body.name;
      tag.normalizedName = body.name.toLowerCase();
    }
    if (body.isPrivate !== undefined) {
      tag.isPrivate = body.isPrivate;
    }

    try {
      await tag.save();
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('A tag with this name already exists', 'USER_TAG_NAME_TAKEN');
      }
      throw err;
    }

    audit(req, {
      action: 'user-tag.update',
      entityType: 'user-tag',
      entityId: id,
      groupId: tag.ownerGroupId.toString(),
      details: { updatedFields: Object.keys(body) },
    });

    res.status(200).json(success(await serializeUserTag(tag)));
  }),
);

// ---------------------------------------------------------------------------------------
// DELETE /:id — owner group (or org admin) only, regardless of any canDelete share grant
// (those only ever govern POST /bulk-remove — see assertCanUseOrRemoveTag's comment).
//
// Cleanup choice: actively strips this tagId from every Article that carries it (rather than
// leaving a dangling reference filtered at read time) so Article.tagIds stays a canonical,
// always-resolvable set with no defensive dangling-ref handling needed anywhere else. ES is
// then best-effort reindexed for the affected articles so search/facets do not keep a stale
// tag id (Mongo remains the system of record if that sync fails).
// ---------------------------------------------------------------------------------------
userTagRouter.delete(
  '/:id',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User tag not found', 'USER_TAG_NOT_FOUND');
    const tag = await UserTagModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!tag) {
      throw new NotFoundError('User tag not found', 'USER_TAG_NOT_FOUND');
    }

    await assertGroupScopedPermission(req.user, 'user-tags:manage' satisfies Permission, tag.ownerGroupId.toString());

    const affectedIds = (
      await ArticleModel.find({ orgId: req.user.orgId, tagIds: tag._id }, { _id: 1 })
    ).map((article) => article._id);

    await UserTagModel.deleteOne({ _id: id, orgId: req.user.orgId });
    await ArticleModel.updateMany(
      { orgId: req.user.orgId, tagIds: tag._id },
      { $pull: { tagIds: tag._id } },
    );

    if (affectedIds.length > 0) {
      const changed = await ArticleModel.find({ _id: { $in: affectedIds }, orgId: req.user.orgId });
      try {
        await bulkIndexArticles(req.user.orgId, changed.map(toIndexArticleParams), { refresh: true });
      } catch (err) {
        logger.error({ err, tagId: id }, 'Failed to sync untagged articles to Elasticsearch after tag delete');
      }
    }

    audit(req, {
      action: 'user-tag.delete',
      entityType: 'user-tag',
      entityId: id,
      groupId: tag.ownerGroupId.toString(),
      details: { name: tag.name },
    });

    res.status(200).json(success(null));
  }),
);

// ---------------------------------------------------------------------------------------
// POST /:id/publish — user-tags:publish, scoped to the tag's owner group (or org admin).
// ---------------------------------------------------------------------------------------
userTagRouter.post(
  '/:id/publish',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User tag not found', 'USER_TAG_NOT_FOUND');
    const tag = await UserTagModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!tag) {
      throw new NotFoundError('User tag not found', 'USER_TAG_NOT_FOUND');
    }

    await assertGroupScopedPermission(req.user, 'user-tags:publish' satisfies Permission, tag.ownerGroupId.toString());

    tag.isPublished = true;
    await tag.save();

    audit(req, {
      action: 'user-tag.publish',
      entityType: 'user-tag',
      entityId: id,
      groupId: tag.ownerGroupId.toString(),
      details: { name: tag.name },
    });

    res.status(200).json(success(await serializeUserTag(tag)));
  }),
);

// ---------------------------------------------------------------------------------------
// POST /:id/share — user-tags:shareIntoGroups, scoped to the tag's owner group (or org
// admin): sharing a tag further is itself an owner-only decision, never delegable via a
// grant a non-owner group already holds. Body shape follows the canonical
// shareUserTagSchema (an array of grants, `{ grants: [{ groupId, canUse, canDelete }] }`)
// rather than this feature's paraphrased single-grant shape, per the "match field names
// exactly against the canonical validator" instruction — a single share call can upsert one
// or many grants at once.
//
// canUse/canDelete are NOT "can delete the tag" — they gate POST /bulk-apply and
// POST /bulk-remove respectively for articles the granted group can otherwise see (see
// assertCanUseOrRemoveTag). DELETE /:id (the tag entity itself) stays owner-group/org-admin
// only no matter what any grant here says.
// ---------------------------------------------------------------------------------------
userTagRouter.post(
  '/:id/share',
  authenticate,
  orgContext,
  validate({ body: shareUserTagSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User tag not found', 'USER_TAG_NOT_FOUND');
    const tag = await UserTagModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!tag) {
      throw new NotFoundError('User tag not found', 'USER_TAG_NOT_FOUND');
    }

    await assertGroupScopedPermission(req.user, 'user-tags:shareIntoGroups' satisfies Permission, tag.ownerGroupId.toString());

    const { grants } = req.body as ShareUserTagInput;
    const ownerGroupIdStr = tag.ownerGroupId.toString();
    for (const grant of grants) {
      if (!mongoose.isValidObjectId(grant.groupId)) {
        throw new ValidationError('grants[].groupId must be a valid id');
      }
      if (grant.groupId === ownerGroupIdStr) {
        throw new ValidationError('Cannot share a tag into its own owner group');
      }
    }

    const targetGroups = await GroupModel.find(
      { _id: { $in: grants.map((grant) => grant.groupId) }, orgId: req.user.orgId },
      { _id: 1 },
    );
    const validGroupIds = new Set(targetGroups.map((group) => group._id.toString()));
    for (const grant of grants) {
      if (!validGroupIds.has(grant.groupId)) {
        throw new NotFoundError(`Group ${grant.groupId} not found`, 'GROUP_NOT_FOUND');
      }
    }

    for (const grant of grants) {
      const existing = tag.sharedWithGroups.find((g) => g.groupId.toString() === grant.groupId);
      if (existing) {
        existing.canUse = grant.canUse;
        existing.canDelete = grant.canDelete;
      } else {
        tag.sharedWithGroups.push({
          groupId: new mongoose.Types.ObjectId(grant.groupId),
          canUse: grant.canUse,
          canDelete: grant.canDelete,
        });
      }
    }
    await tag.save();

    audit(req, {
      action: 'user-tag.share',
      entityType: 'user-tag',
      entityId: id,
      groupId: tag.ownerGroupId.toString(),
      details: { grants },
    });

    res.status(200).json(success(await serializeUserTag(tag)));
  }),
);

// ---------------------------------------------------------------------------------------
// DELETE /:id/share/:groupId — revoke. Same owner-group/org-admin gate as granting.
// ---------------------------------------------------------------------------------------
userTagRouter.delete(
  '/:id/share/:groupId',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'User tag not found', 'USER_TAG_NOT_FOUND');
    const groupId = parseObjectIdParam(
      req.params.groupId,
      'This tag is not shared with that group',
      'USER_TAG_SHARE_NOT_FOUND',
    );

    const tag = await UserTagModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!tag) {
      throw new NotFoundError('User tag not found', 'USER_TAG_NOT_FOUND');
    }

    await assertGroupScopedPermission(req.user, 'user-tags:shareIntoGroups' satisfies Permission, tag.ownerGroupId.toString());

    const before = tag.sharedWithGroups.length;
    tag.sharedWithGroups = tag.sharedWithGroups.filter((grant) => grant.groupId.toString() !== groupId);
    if (tag.sharedWithGroups.length === before) {
      throw new NotFoundError('This tag is not shared with that group', 'USER_TAG_SHARE_NOT_FOUND');
    }
    await tag.save();

    audit(req, {
      action: 'user-tag.share',
      entityType: 'user-tag',
      entityId: id,
      groupId: tag.ownerGroupId.toString(),
      details: { revokedGroupId: groupId },
    });

    res.status(200).json(success(await serializeUserTag(tag)));
  }),
);

// ---------------------------------------------------------------------------------------
// POST /bulk-apply and POST /bulk-remove — attach/detach one tag across many articles for
// the Articles UI's bulk-tag action. No canonical shared schema exists yet for this body
// shape, so it's validated with a small schema local to this route file (never diverging
// from the `{ articleIds: string[], tagId: string }` shape this feature specifies).
// ---------------------------------------------------------------------------------------

const bulkTagArticlesSchema = z
  .object({
    articleIds: z.array(z.string().min(1)).min(1).max(500),
    tagId: z.string().min(1),
  })
  .strict();
type BulkTagArticlesInput = z.infer<typeof bulkTagArticlesSchema>;

async function bulkTagOperation(
  req: express.Request,
  res: express.Response,
  mode: 'apply' | 'remove',
): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
  }
  const { articleIds, tagId } = req.body as BulkTagArticlesInput;

  if (!mongoose.isValidObjectId(tagId)) {
    throw new NotFoundError('User tag not found', 'USER_TAG_NOT_FOUND');
  }
  const tag = await UserTagModel.findOne({ _id: tagId, orgId: req.user.orgId });
  if (!tag) {
    throw new NotFoundError('User tag not found', 'USER_TAG_NOT_FOUND');
  }

  // The one CanUse (or CanDelete, for remove) permission check per tag referenced by this
  // route's spec — checked once against the single tag, not per article.
  await assertCanUseOrRemoveTag(req.user, tag, mode === 'apply' ? 'use' : 'delete');

  const uniqueIds = Array.from(new Set(articleIds)).filter((articleId) => mongoose.isValidObjectId(articleId));
  const articles = await ArticleModel.find(
    { _id: { $in: uniqueIds }, orgId: req.user.orgId },
    { _id: 1, tagIds: 1 },
  );
  const articleById = new Map(articles.map((article) => [article._id.toString(), article]));

  const results: BulkOperationItemResult[] = [];
  const changedIds: string[] = [];

  for (const articleId of articleIds) {
    const article = articleById.get(articleId);
    if (!article) {
      results.push({ id: articleId, success: false, error: 'Article not found' });
      continue;
    }
    const hasTag = article.tagIds.some((t) => t.toString() === tag._id.toString());
    const alreadyInDesiredState = (mode === 'apply' && hasTag) || (mode === 'remove' && !hasTag);
    if (!alreadyInDesiredState) {
      changedIds.push(articleId);
    }
    results.push({ id: articleId, success: true });
  }

  if (changedIds.length > 0) {
    await ArticleModel.updateMany(
      { _id: { $in: changedIds }, orgId: req.user.orgId },
      mode === 'apply' ? { $addToSet: { tagIds: tag._id } } : { $pull: { tagIds: tag._id } },
    );
    // articleCount is a maintained counter (not derived live) — see userTag.model.ts — kept
    // accurate here since `changedIds` only ever contains articles that actually flip state.
    await UserTagModel.updateOne(
      { _id: tag._id },
      { $inc: { articleCount: mode === 'apply' ? changedIds.length : -changedIds.length } },
    );
    // Search/facets read tagIds from Elasticsearch, not Mongo. Without this, the filter
    // panel's org-wide articleCount and the Articles result list disagree (seed's
    // bulk-apply previously wrote Mongo only).
    const changed = await ArticleModel.find({ _id: { $in: changedIds }, orgId: req.user.orgId });
    try {
      await bulkIndexArticles(req.user.orgId, changed.map(toIndexArticleParams), { refresh: true });
    } catch (err) {
      logger.error({ err, articleIds: changedIds }, 'Failed to sync tagged articles to Elasticsearch');
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const result: BulkOperationResult = {
    requested: articleIds.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };

  audit(req, {
    action: mode === 'apply' ? 'article.tag' : 'article.untag',
    entityType: 'article',
    groupId: tag.ownerGroupId.toString(),
    details: { tagId, tagName: tag.name, requested: result.requested, succeeded, failed: result.failed },
  });

  res.status(200).json(success(result));
}

userTagRouter.post(
  '/bulk-apply',
  authenticate,
  orgContext,
  validate({ body: bulkTagArticlesSchema }),
  asyncHandler((req, res) => bulkTagOperation(req, res, 'apply')),
);

userTagRouter.post(
  '/bulk-remove',
  authenticate,
  orgContext,
  validate({ body: bulkTagArticlesSchema }),
  asyncHandler((req, res) => bulkTagOperation(req, res, 'remove')),
);
