import express from 'express';
import mongoose from 'mongoose';

import {
  addProjectMemberSchema,
  createProjectSchema,
  updateProjectSchema,
  type PaginatedResult,
  type Permission,
  type Project,
  type ProjectMember,
} from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { success } from '../lib/response.js';
import { toProjectDTO, toProjectMemberDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
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
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const rawPage = Number(req.query.page ?? 1);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

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
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    const { name, description } = parsed.data;

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
    const { id } = req.params;
    if (!id || !mongoose.isValidObjectId(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

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
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const { id } = req.params;
    if (!id || !mongoose.isValidObjectId(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request body');
    }

    const doc = await ProjectModel.findOneAndUpdate(
      { _id: id, orgId: req.user.orgId },
      { $set: parsed.data },
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
    const { id } = req.params;
    if (!id || !mongoose.isValidObjectId(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

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
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const { id } = req.params;
    if (!id || !mongoose.isValidObjectId(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const parsed = addProjectMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    const { userId, roleId } = parsed.data;
    if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(roleId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'userId and roleId must be valid ids');
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
    const { id, userId } = req.params;
    if (!id || !mongoose.isValidObjectId(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    if (!userId || !mongoose.isValidObjectId(userId)) {
      throw new AppError(404, 'PROJECT_MEMBER_NOT_FOUND', 'Project member not found');
    }

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
