import express from 'express';

import {
  asOrgId,
  asProjectId,
  createProjectSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type PaginatedResult,
  type Permission,
  type Project,
  type UpdateProjectInput,
} from '@content-insights/shared';

import { audit } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { pageQuerySchema, type PageQuery } from '../lib/pagination.js';
import { hasPermission, isRoleAssignmentActive } from '../lib/permissions.js';
import { success } from '../lib/response.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { ArticleModel } from '../models/article.model.js';
import { GroupModel } from '../models/group.model.js';
import { ProjectModel, type ProjectDocument } from '../models/project.model.js';
import type { AuthenticatedUser } from '../types/express.js';

export const projectRouter = express.Router();

const PAGE_SIZE = 20;

function toProjectDTO(doc: ProjectDocument): Project {
  return {
    id: asProjectId(doc._id.toString()),
    orgId: asOrgId(doc.orgId.toString()),
    name: doc.name,
    description: doc.description,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

interface ProjectVisibility {
  // true => caller may see every Project in the org (Application Admin, or any custom role
  // holding projects:read/projects:manage GLOBALLY — see AuthenticatedUser.globalPermissions'
  // own comment for why only the global-scope grant is denormalized onto the JWT).
  orgWide: boolean;
  // Only meaningful when orgWide is false: the union of Group.dataAccess.projectIds across
  // every group the caller currently belongs to (i.e. holds ANY active roleAssignment in),
  // regardless of which permission that particular role grants — membership itself is what
  // grants project visibility, not a specific permission key.
  projectIds: string[];
}

async function resolveProjectVisibility(user: AuthenticatedUser): Promise<ProjectVisibility> {
  if (
    hasPermission(user, 'projects:read' satisfies Permission) ||
    hasPermission(user, 'projects:manage' satisfies Permission)
  ) {
    return { orgWide: true, projectIds: [] };
  }

  const now = new Date();
  const groupIds = Array.from(
    new Set(
      user.roleAssignments
        .filter((assignment) => assignment.groupId !== null && isRoleAssignmentActive(assignment, now))
        .map((assignment) => assignment.groupId as string),
    ),
  );
  if (groupIds.length === 0) {
    return { orgWide: false, projectIds: [] };
  }

  const groups = await GroupModel.find(
    { _id: { $in: groupIds }, orgId: user.orgId },
    { 'dataAccess.projectIds': 1 },
  );
  const projectIdSet = new Set<string>();
  for (const group of groups) {
    for (const projectId of group.dataAccess.projectIds) {
      projectIdSet.add(projectId.toString());
    }
  }
  return { orgWide: false, projectIds: Array.from(projectIdSet) };
}

// No permission gate beyond org membership (matches GET /api/roles) — visibility is
// resolved per-caller below rather than gated by a single permission check up front.
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
    const visibility = await resolveProjectVisibility(req.user);

    if (!visibility.orgWide && visibility.projectIds.length === 0) {
      res.status(200).json(
        success({
          items: [],
          page,
          pageSize: PAGE_SIZE,
          total: 0,
          totalPages: 0,
        } satisfies PaginatedResult<Project>),
      );
      return;
    }

    const filter: Record<string, unknown> = { orgId: req.user.orgId };
    if (!visibility.orgWide) {
      filter._id = { $in: visibility.projectIds };
    }

    const [docs, total] = await Promise.all([
      ProjectModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE),
      ProjectModel.countDocuments(filter),
    ]);

    const result: PaginatedResult<Project> = {
      items: docs.map(toProjectDTO),
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
    const doc = await ProjectModel.create({ orgId: req.user.orgId, name, description });

    audit(req, {
      action: 'project.create',
      entityType: 'project',
      entityId: doc._id.toString(),
      details: { name },
    });

    res.status(201).json(success(toProjectDTO(doc)));
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

    // Same visibility rule as GET / — a project outside the caller's accessible set 404s
    // rather than 403s (its existence isn't legitimate knowledge for them), matching this
    // codebase's established "wrong-org/out-of-scope id 404s, never 403s" convention.
    const visibility = await resolveProjectVisibility(req.user);
    if (!visibility.orgWide && !visibility.projectIds.includes(id)) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const doc = await ProjectModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!doc) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    res.status(200).json(success(toProjectDTO(doc)));
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
    );
    if (!doc) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    audit(req, {
      action: 'project.update',
      entityType: 'project',
      entityId: id,
      details: { updatedFields: Object.keys(body) },
    });

    res.status(200).json(success(toProjectDTO(doc)));
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

    // A project still holding live articles, or still granted to a group's dataAccess, must
    // not be deleted out from under them — same "block + explain, don't orphan" rule as
    // role.routes.ts's ROLE_IN_USE check.
    const [articleCount, groupCount] = await Promise.all([
      ArticleModel.countDocuments({ orgId: req.user.orgId, projectId: id }),
      GroupModel.countDocuments({ orgId: req.user.orgId, 'dataAccess.projectIds': id }),
    ]);
    if (articleCount > 0 || groupCount > 0) {
      throw new AppError(
        409,
        'PROJECT_IN_USE',
        `Cannot delete project: it is referenced by ${articleCount} article(s) and granted to ${groupCount} group(s)`,
      );
    }

    const doc = await ProjectModel.findOneAndDelete({ _id: id, orgId: req.user.orgId });
    if (!doc) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    audit(req, {
      action: 'project.delete',
      entityType: 'project',
      entityId: id,
      details: { name: doc.name },
    });

    res.status(200).json(success(null));
  }),
);
