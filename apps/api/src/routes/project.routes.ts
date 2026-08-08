import express from 'express';
import mongoose from 'mongoose';

import {
  addProjectMemberSchema,
  createProjectSchema,
  updateProjectSchema,
  type AddProjectMemberInput,
  type CreateProjectInput,
  type PaginatedResult,
  type Permission,
  type Project,
  type ProjectMember,
  type UpdateProjectInput,
} from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ValidationError } from '../lib/errors.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { pageQuerySchema, type PageQuery } from '../lib/pagination.js';
import { success } from '../lib/response.js';
import { toProjectDTO, toProjectMemberDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { ProjectModel } from '../models/project.model.js';
import { RoleModel, type RoleDocument } from '../models/role.model.js';
import { UserModel, type UserDocument } from '../models/user.model.js';

export const projectRouter = express.Router();

const PAGE_SIZE = 20;
const MEMBER_POPULATE = [{ path: 'members.userId' }, { path: 'members.roleId' }];

interface PopulatedMember {
  userId: UserDocument | null;
  roleId: RoleDocument | null;
}

// Populated refs are typed defensively as nullable — can't currently happen (no user/role
// delete endpoint exists), but a dangling ref should be dropped, not crash on `.email`/`.name`.
function enrichMembers(members: PopulatedMember[]): ProjectMember[] {
  return members
    .filter(
      (m): m is { userId: UserDocument; roleId: RoleDocument } => m.userId !== null && m.roleId !== null,
    )
    .map(toProjectMemberDTO);
}

projectRouter.get(
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
      ProjectModel.find({ orgId: req.user.orgId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .populate<{ members: PopulatedMember[] }>(MEMBER_POPULATE),
      ProjectModel.countDocuments({ orgId: req.user.orgId }),
    ]);

    const result: PaginatedResult<Project> = {
      items: docs.map((doc) => toProjectDTO(doc, enrichMembers(doc.members))),
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };

    res.status(200).json(success(result));
  }),
);

projectRouter.post(
  '/',
  authenticate,
  orgContext,
  requirePermission('projects:manage' satisfies Permission),
  validate({ body: createProjectSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { name, description } = req.body as CreateProjectInput;

    const doc = await ProjectModel.create({
      orgId: req.user.orgId,
      name,
      description: description ?? '',
      members: [],
    });

    res.status(201).json(success(toProjectDTO(doc, [])));
  }),
);

projectRouter.get(
  '/:id',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Project not found', 'PROJECT_NOT_FOUND');

    const doc = await ProjectModel.findOne({ _id: id, orgId: req.user.orgId }).populate<{
      members: PopulatedMember[];
    }>(MEMBER_POPULATE);
    if (!doc) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    res.status(200).json(success(toProjectDTO(doc, enrichMembers(doc.members))));
  }),
);

projectRouter.put(
  '/:id',
  authenticate,
  orgContext,
  requirePermission('projects:manage' satisfies Permission),
  validate({ body: updateProjectSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Project not found', 'PROJECT_NOT_FOUND');
    const body = req.body as UpdateProjectInput;

    const doc = await ProjectModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId },
      { $set: body },
      { new: true },
    ).populate<{ members: PopulatedMember[] }>(MEMBER_POPULATE);
    if (!doc) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    res.status(200).json(success(toProjectDTO(doc, enrichMembers(doc.members))));
  }),
);

projectRouter.delete(
  '/:id',
  authenticate,
  orgContext,
  requirePermission('projects:manage' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Project not found', 'PROJECT_NOT_FOUND');

    const doc = await ProjectModel.findOneAndDelete({ _id: id, orgId: req.user.orgId });
    if (!doc) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    res.status(200).json(success(null));
  }),
);

projectRouter.post(
  '/:id/members',
  authenticate,
  orgContext,
  requirePermission('projects:manage' satisfies Permission),
  validate({ body: addProjectMemberSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Project not found', 'PROJECT_NOT_FOUND');

    const { userId, roleId } = req.body as AddProjectMemberInput;
    // Beyond the generic non-empty-string shape validate() already enforced, userId/roleId
    // specifically need to look like Mongo ids — a body-field format issue, so this stays
    // an ordinary 400 (unlike the 404-on-malformed convention for URL path params above).
    if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(roleId)) {
      throw new ValidationError('userId and roleId must be valid ids');
    }

    const project = await ProjectModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!project) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const [user, role] = await Promise.all([
      UserModel.findOne({ _id: userId, orgId: req.user.orgId }),
      RoleModel.findOne({ _id: roleId, orgId: req.user.orgId }),
    ]);
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }
    if (!role) {
      throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
    }

    // Atomic conditional push: avoids a check-then-write race between the membership
    // check and the update. Project already confirmed to exist above, so a null result
    // here means a concurrent request added this member first.
    const updated = await ProjectModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId, 'members.userId': { $ne: userId } },
      { $push: { members: { userId, roleId } } },
      { new: true },
    ).populate<{ members: PopulatedMember[] }>(MEMBER_POPULATE);
    if (!updated) {
      throw new AppError(409, 'PROJECT_MEMBER_EXISTS', 'User is already a member of this project');
    }

    res.status(201).json(success(toProjectDTO(updated, enrichMembers(updated.members))));
  }),
);

projectRouter.delete(
  '/:id/members/:userId',
  authenticate,
  orgContext,
  requirePermission('projects:manage' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Project not found', 'PROJECT_NOT_FOUND');
    const userId = parseObjectIdParam(
      req.params.userId,
      'Project member not found',
      'PROJECT_MEMBER_NOT_FOUND',
    );

    const project = await ProjectModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!project) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const updated = await ProjectModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId, 'members.userId': userId },
      { $pull: { members: { userId } } },
      { new: true },
    ).populate<{ members: PopulatedMember[] }>(MEMBER_POPULATE);
    if (!updated) {
      throw new AppError(404, 'PROJECT_MEMBER_NOT_FOUND', 'Project member not found');
    }

    res.status(200).json(success(toProjectDTO(updated, enrichMembers(updated.members))));
  }),
);
