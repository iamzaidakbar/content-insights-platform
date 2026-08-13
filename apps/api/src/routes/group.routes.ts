import express from 'express';
import mongoose from 'mongoose';

import {
  createGroupSchema,
  setGroupDefaultQuerySchema,
  updateGroupHardFiltersSchema,
  updateGroupProjectsSchema,
  updateGroupSchema,
  updateGroupSoftFiltersSchema,
  type CreateGroupInput,
  type Group,
  type GroupMemberSummary,
  type Permission,
  type PaginatedResult,
  type SetGroupDefaultQueryInput,
  type UpdateGroupHardFiltersInput,
  type UpdateGroupInput,
  type UpdateGroupProjectsInput,
  type UpdateGroupSoftFiltersInput,
} from '@content-insights/shared';

import { audit } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ForbiddenError, ValidationError } from '../lib/errors.js';
import { groupIdFromParam, hasGroupPermission } from '../lib/group-scope.js';
import { isRoleAssignmentActive } from '../lib/permissions.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { pageQuerySchema, type PageQuery } from '../lib/pagination.js';
import { success } from '../lib/response.js';
import {
  toGroupDTO,
  toGroupDefaultQueryDTO,
  toGroupMemberSummaryDTO,
} from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { requireScopedPermission } from '../middleware/requireScopedPermission.js';
import { validate } from '../middleware/validate.js';
import { ConceptModel } from '../models/concept.model.js';
import { GroupModel, type GroupDocument } from '../models/group.model.js';
import { GroupDefaultQueryModel } from '../models/groupDefaultQuery.model.js';
import { ProjectModel } from '../models/project.model.js';
import type { RoleDocument } from '../models/role.model.js';
import { SavedSearchModel } from '../models/savedSearch.model.js';
import { UserModel } from '../models/user.model.js';

export const groupRouter = express.Router();

const PAGE_SIZE = 20;

// A group's roster (GroupMemberSummary[]) is never stored on the Group document itself —
// it's a read-model resolved server-side from every User whose roleAssignments include this
// group (see Group.members's own comment in @content-insights/shared). Batched across
// however many groups are being serialized at once (a list page, or just one via GET /:id)
// so this stays a single query regardless of how many groups/members are involved.
interface PopulatedMemberRoleAssignment {
  _id: mongoose.Types.ObjectId;
  roleId: RoleDocument | mongoose.Types.ObjectId;
  groupId: mongoose.Types.ObjectId | null;
  startDate: Date | null;
  endDate: Date | null;
}

async function resolveGroupMembersByGroupId(
  orgId: string,
  groupIds: string[],
): Promise<Map<string, GroupMemberSummary[]>> {
  const membersByGroupId = new Map<string, GroupMemberSummary[]>();
  if (groupIds.length === 0) {
    return membersByGroupId;
  }
  const groupIdSet = new Set(groupIds);

  const users = await UserModel.find({
    orgId,
    'roleAssignments.groupId': { $in: groupIds },
  }).populate<{ roleAssignments: PopulatedMemberRoleAssignment[] }>('roleAssignments.roleId');

  for (const user of users) {
    for (const assignment of user.roleAssignments) {
      if (!assignment.groupId) continue;
      const groupId = assignment.groupId.toString();
      if (!groupIdSet.has(groupId)) continue;
      const role = assignment.roleId;
      // Dangling role reference — drop, same convention as toUserDTO's roleAssignments.
      if (!role || role instanceof mongoose.Types.ObjectId) continue;

      const summary = toGroupMemberSummaryDTO(user, role, assignment.startDate, assignment.endDate);
      const existing = membersByGroupId.get(groupId);
      if (existing) {
        existing.push(summary);
      } else {
        membersByGroupId.set(groupId, [summary]);
      }
    }
  }

  return membersByGroupId;
}

// hardFilterGrants/softFilterConcepts only store conceptId — conceptName is denormalized
// onto the DTO fresh from the live Concept, same "read-model" treatment as group membership
// above. Batched across every group being serialized.
async function resolveConceptNamesById(
  orgId: string,
  groups: Pick<GroupDocument, 'dataAccess'>[],
): Promise<Map<string, string>> {
  const conceptIds = new Set<string>();
  for (const group of groups) {
    for (const grant of group.dataAccess.hardFilterGrants) {
      conceptIds.add(grant.conceptId.toString());
    }
    for (const grant of group.dataAccess.softFilterConcepts) {
      conceptIds.add(grant.conceptId.toString());
    }
  }
  if (conceptIds.size === 0) {
    return new Map();
  }
  const concepts = await ConceptModel.find(
    { _id: { $in: Array.from(conceptIds) }, orgId },
    { name: 1 },
  );
  return new Map(concepts.map((concept) => [concept._id.toString(), concept.name]));
}

async function buildGroupDTO(orgId: string, group: GroupDocument): Promise<Group> {
  const groupId = group._id.toString();
  const [membersByGroupId, conceptNamesById] = await Promise.all([
    resolveGroupMembersByGroupId(orgId, [groupId]),
    resolveConceptNamesById(orgId, [group]),
  ]);
  return toGroupDTO(group, membersByGroupId.get(groupId) ?? [], conceptNamesById);
}

groupRouter.get(
  '/',
  authenticate,
  orgContext,
  validate({ query: pageQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { page = 1 } = req.query as unknown as PageQuery;

    const [docs, total] = await Promise.all([
      GroupModel.find({ orgId: req.user.orgId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE),
      GroupModel.countDocuments({ orgId: req.user.orgId }),
    ]);

    const groupIds = docs.map((doc) => doc._id.toString());
    const [membersByGroupId, conceptNamesById] = await Promise.all([
      resolveGroupMembersByGroupId(req.user.orgId, groupIds),
      resolveConceptNamesById(req.user.orgId, docs),
    ]);

    const result: PaginatedResult<Group> = {
      items: docs.map((doc) =>
        toGroupDTO(doc, membersByGroupId.get(doc._id.toString()) ?? [], conceptNamesById),
      ),
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };

    res.status(200).json(success(result));
  }),
);

// Container CRUD (create/rename/delete the Group itself) stays org-wide-only by
// construction — plain requirePermission, never requireScopedPermission. Data access and
// membership (via role assignments) below use requireScopedPermission instead, which is
// what lets a group-scoped grant (e.g. a User Group Admin scoped to one group) manage that
// one group's data access without holding groups:manage org-wide.
groupRouter.post(
  '/',
  authenticate,
  orgContext,
  requirePermission('groups:manage' satisfies Permission),
  validate({ body: createGroupSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { name, description } = req.body as CreateGroupInput;

    const doc = await GroupModel.create({
      orgId: req.user.orgId,
      name,
      description: description ?? '',
    });

    audit(req, {
      action: 'group.create',
      entityType: 'group',
      entityId: doc._id.toString(),
      groupId: doc._id.toString(),
      details: { name },
    });

    res.status(201).json(success(await buildGroupDTO(req.user.orgId, doc)));
  }),
);

groupRouter.get(
  '/:id',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Group not found', 'GROUP_NOT_FOUND');

    const doc = await GroupModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!doc) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    res.status(200).json(success(await buildGroupDTO(req.user.orgId, doc)));
  }),
);

groupRouter.put(
  '/:id',
  authenticate,
  orgContext,
  requirePermission('groups:manage' satisfies Permission),
  validate({ body: updateGroupSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Group not found', 'GROUP_NOT_FOUND');
    const body = req.body as UpdateGroupInput;

    const doc = await GroupModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId },
      { $set: body },
      { new: true },
    );
    if (!doc) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    audit(req, {
      action: 'group.update',
      entityType: 'group',
      entityId: id,
      groupId: id,
      details: { updatedFields: Object.keys(body) },
    });

    res.status(200).json(success(await buildGroupDTO(req.user.orgId, doc)));
  }),
);

groupRouter.delete(
  '/:id',
  authenticate,
  orgContext,
  requirePermission('groups:manage' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Group not found', 'GROUP_NOT_FOUND');

    const group = await GroupModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!group) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    const [defaultQueryCount, usersWithGroup] = await Promise.all([
      GroupDefaultQueryModel.countDocuments({ orgId: req.user.orgId, groupId: id }),
      UserModel.find({ orgId: req.user.orgId, 'roleAssignments.groupId': id }, { roleAssignments: 1 }),
    ]);
    const hasActiveMember = usersWithGroup.some((user) =>
      user.roleAssignments.some(
        (assignment) => assignment.groupId?.toString() === id && isRoleAssignmentActive(assignment),
      ),
    );
    if (defaultQueryCount > 0 || hasActiveMember) {
      const reasons: string[] = [];
      if (defaultQueryCount > 0) {
        reasons.push(`${defaultQueryCount} default quer${defaultQueryCount === 1 ? 'y' : 'ies'} reference${defaultQueryCount === 1 ? 's' : ''} it`);
      }
      if (hasActiveMember) {
        reasons.push('it has at least one active member');
      }
      throw new AppError(409, 'GROUP_IN_USE', `Group cannot be deleted: ${reasons.join(' and ')}`);
    }

    await GroupModel.deleteOne({ _id: id, orgId: req.user.orgId });

    audit(req, {
      action: 'group.delete',
      entityType: 'group',
      entityId: id,
      details: { name: group.name },
    });

    res.status(200).json(success(null));
  }),
);

// ---------------------------------------------------------------------------------------
// Data access sub-resource (groups:manageDataAccess) — deliberately separate from container
// CRUD (groups:manage) above, and split into three endpoints (rather than one big PUT
// mirroring GroupDataAccess wholesale) so a client editing e.g. just the project list never
// has to round-trip the full hard/soft filter grant arrays it isn't touching.
// ---------------------------------------------------------------------------------------

groupRouter.put(
  '/:id/data-access/projects',
  authenticate,
  orgContext,
  requireScopedPermission('groups:manageDataAccess' satisfies Permission, groupIdFromParam('id')),
  validate({ body: updateGroupProjectsSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Group not found', 'GROUP_NOT_FOUND');
    const { projectIds } = req.body as UpdateGroupProjectsInput;

    for (const projectId of projectIds) {
      if (!mongoose.isValidObjectId(projectId)) {
        throw new ValidationError(`Invalid projectId: ${projectId}`);
      }
    }
    const uniqueProjectIds = Array.from(new Set(projectIds));
    if (uniqueProjectIds.length > 0) {
      const count = await ProjectModel.countDocuments({
        _id: { $in: uniqueProjectIds },
        orgId: req.user.orgId,
      });
      if (count !== uniqueProjectIds.length) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'One or more projects were not found');
      }
    }

    const updated = await GroupModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId },
      { $set: { 'dataAccess.projectIds': uniqueProjectIds } },
      { new: true },
    );
    if (!updated) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    audit(req, {
      action: 'group.update',
      entityType: 'group',
      entityId: id,
      groupId: id,
      details: { field: 'projectIds', projectIds: uniqueProjectIds },
    });

    res.status(200).json(success(await buildGroupDTO(req.user.orgId, updated)));
  }),
);

groupRouter.put(
  '/:id/data-access/hard-filters',
  authenticate,
  orgContext,
  requireScopedPermission('groups:manageDataAccess' satisfies Permission, groupIdFromParam('id')),
  validate({ body: updateGroupHardFiltersSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Group not found', 'GROUP_NOT_FOUND');
    const { hardFilterGrants } = req.body as UpdateGroupHardFiltersInput;

    const conceptIds = hardFilterGrants.map((grant) => grant.conceptId);
    if (new Set(conceptIds).size !== conceptIds.length) {
      throw new ValidationError('hardFilterGrants contains duplicate conceptId entries');
    }
    for (const conceptId of conceptIds) {
      if (!mongoose.isValidObjectId(conceptId)) {
        throw new ValidationError(`Invalid conceptId: ${conceptId}`);
      }
    }
    const concepts =
      conceptIds.length > 0
        ? await ConceptModel.find({ _id: { $in: conceptIds }, orgId: req.user.orgId })
        : [];
    const conceptById = new Map(concepts.map((concept) => [concept._id.toString(), concept]));
    for (const conceptId of conceptIds) {
      const concept = conceptById.get(conceptId);
      if (!concept) {
        throw new AppError(404, 'CONCEPT_NOT_FOUND', `Concept not found: ${conceptId}`);
      }
      if (concept.placement !== 'hard') {
        throw new ValidationError(`Concept "${concept.name}" is not a hard-filter concept`);
      }
    }

    const updated = await GroupModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId },
      {
        $set: {
          'dataAccess.hardFilterGrants': hardFilterGrants.map((grant) => ({
            conceptId: grant.conceptId,
            allowedValues: grant.allowedValues,
            ...(grant.denialNote !== undefined ? { denialNote: grant.denialNote } : {}),
          })),
        },
      },
      { new: true },
    );
    if (!updated) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    audit(req, {
      action: 'group.update',
      entityType: 'group',
      entityId: id,
      groupId: id,
      details: { field: 'hardFilterGrants', conceptIds },
    });

    res.status(200).json(success(await buildGroupDTO(req.user.orgId, updated)));
  }),
);

groupRouter.put(
  '/:id/data-access/soft-filters',
  authenticate,
  orgContext,
  requireScopedPermission('groups:manageDataAccess' satisfies Permission, groupIdFromParam('id')),
  validate({ body: updateGroupSoftFiltersSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Group not found', 'GROUP_NOT_FOUND');
    const { softFilterConcepts } = req.body as UpdateGroupSoftFiltersInput;

    const conceptIds = softFilterConcepts.map((grant) => grant.conceptId);
    if (new Set(conceptIds).size !== conceptIds.length) {
      throw new ValidationError('softFilterConcepts contains duplicate conceptId entries');
    }
    for (const conceptId of conceptIds) {
      if (!mongoose.isValidObjectId(conceptId)) {
        throw new ValidationError(`Invalid conceptId: ${conceptId}`);
      }
    }
    const concepts =
      conceptIds.length > 0
        ? await ConceptModel.find({ _id: { $in: conceptIds }, orgId: req.user.orgId })
        : [];
    const conceptById = new Map(concepts.map((concept) => [concept._id.toString(), concept]));
    for (const conceptId of conceptIds) {
      const concept = conceptById.get(conceptId);
      if (!concept) {
        throw new AppError(404, 'CONCEPT_NOT_FOUND', `Concept not found: ${conceptId}`);
      }
      if (concept.placement !== 'soft') {
        throw new ValidationError(`Concept "${concept.name}" is not a soft-filter concept`);
      }
    }

    const updated = await GroupModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId },
      {
        $set: {
          'dataAccess.softFilterConcepts': softFilterConcepts.map((grant) => ({
            conceptId: grant.conceptId,
            order: grant.order,
          })),
        },
      },
      { new: true },
    );
    if (!updated) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    audit(req, {
      action: 'group.update',
      entityType: 'group',
      entityId: id,
      groupId: id,
      details: { field: 'softFilterConcepts', conceptIds },
    });

    res.status(200).json(success(await buildGroupDTO(req.user.orgId, updated)));
  }),
);

// ---------------------------------------------------------------------------------------
// Default query (landing saved search per group + project). Writes stay gated on
// groups:manageDataAccess. Reads are allowed for group members as well — Articles landing
// needs the configured default and those users are not data-access admins.
// ---------------------------------------------------------------------------------------

groupRouter.get(
  '/:id/default-queries',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Group not found', 'GROUP_NOT_FOUND');

    const group = await GroupModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!group) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }

    const canManage = await hasGroupPermission(req.user, 'groups:manageDataAccess', id);
    const isMember = req.user.roleAssignments.some(
      (assignment) => assignment.groupId === id && isRoleAssignmentActive(assignment),
    );
    if (!canManage && !isMember) {
      throw new ForbiddenError('Missing required permission: groups:manageDataAccess');
    }

    const docs = await GroupDefaultQueryModel.find({ orgId: req.user.orgId, groupId: id });
    const savedSearchIds = docs.map((doc) => doc.savedSearchId.toString());
    const savedSearches =
      savedSearchIds.length > 0
        ? await SavedSearchModel.find({ _id: { $in: savedSearchIds }, orgId: req.user.orgId }, { name: 1 })
        : [];
    const nameById = new Map(savedSearches.map((search) => [search._id.toString(), search.name]));

    res.status(200).json(
      success(
        docs.map((doc) => toGroupDefaultQueryDTO(doc, nameById.get(doc.savedSearchId.toString()) ?? '')),
      ),
    );
  }),
);

groupRouter.put(
  '/:id/default-query',
  authenticate,
  orgContext,
  requireScopedPermission('groups:manageDataAccess' satisfies Permission, groupIdFromParam('id')),
  validate({ body: setGroupDefaultQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Group not found', 'GROUP_NOT_FOUND');
    const { projectId, savedSearchId } = req.body as SetGroupDefaultQueryInput;

    const group = await GroupModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!group) {
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found');
    }
    const project = await ProjectModel.findOne({ _id: projectId, orgId: req.user.orgId });
    if (!project) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    if (savedSearchId === null) {
      await GroupDefaultQueryModel.findOneAndDelete({ orgId: req.user.orgId, groupId: id, projectId });
      audit(req, {
        action: 'saved-search.set_default',
        entityType: 'group',
        entityId: id,
        groupId: id,
        details: { projectId },
      });
      res.status(200).json(success(null));
      return;
    }

    const savedSearch = await SavedSearchModel.findOne({ _id: savedSearchId, orgId: req.user.orgId });
    if (!savedSearch) {
      throw new AppError(404, 'SAVED_SEARCH_NOT_FOUND', 'Saved search not found');
    }

    const doc = await GroupDefaultQueryModel.findOneAndUpdate(
      { orgId: req.user.orgId, groupId: id, projectId },
      { $set: { savedSearchId } },
      { new: true, upsert: true },
    );

    audit(req, {
      action: 'saved-search.set_default',
      entityType: 'group',
      entityId: id,
      groupId: id,
      details: { projectId, savedSearchId, savedSearchName: savedSearch.name },
    });

    res.status(200).json(success(toGroupDefaultQueryDTO(doc, savedSearch.name)));
  }),
);

// Always allowed — just clears the pointer. The rule that blocks deleting a saved search
// WHILE it's referenced as some group's default query lives in savedSearch.routes.ts (it
// has to check GroupDefaultQuery, not the other way around); this endpoint has no analogous
// restriction of its own.
groupRouter.delete(
  '/:id/default-query/:projectId',
  authenticate,
  orgContext,
  requireScopedPermission('groups:manageDataAccess' satisfies Permission, groupIdFromParam('id')),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Group not found', 'GROUP_NOT_FOUND');
    const projectId = parseObjectIdParam(
      req.params.projectId,
      'Project not found',
      'PROJECT_NOT_FOUND',
    );

    await GroupDefaultQueryModel.findOneAndDelete({ orgId: req.user.orgId, groupId: id, projectId });

    audit(req, {
      action: 'saved-search.set_default',
      entityType: 'group',
      entityId: id,
      groupId: id,
      details: { projectId },
    });

    res.status(200).json(success(null));
  }),
);
