import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import {
  DEFAULT_USER_SETTINGS,
  updateFilterLayoutSchema,
  updateGlobalSettingsSchema,
  updateUserSettingsSchema,
  type Permission,
  type UpdateFilterLayoutInput,
  type UpdateGlobalSettingsInput,
  type UpdateUserSettingsInput,
  type UserSettingsDefaults,
} from '@content-insights/shared';

import { audit } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, isDuplicateKeyError, NotFoundError } from '../lib/errors.js';
import { flattenToDotNotation } from '../lib/flatten.js';
import { success } from '../lib/response.js';
import { toFilterLayoutDTO, toGlobalSettingsDTO, toUserSettingsDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { FilterLayoutModel, type FilterLayoutDocument } from '../models/filterLayout.model.js';
import { GlobalSettingsModel, type GlobalSettingsDocument } from '../models/globalSettings.model.js';
import { ProjectModel } from '../models/project.model.js';
import { UserSettingsModel, type UserSettingsDocument } from '../models/userSettings.model.js';

export const settingsRouter = express.Router();

// Shared by GET /me and PATCH /me — both need a guaranteed-to-exist record before doing
// anything else. find-then-create (not a blind upsert) so a first-ever GET and a
// first-ever PATCH both converge on exactly one seeded document, never two partial ones.
async function getOrCreateUserSettings(
  userId: mongoose.Types.ObjectId | string,
  orgId: mongoose.Types.ObjectId | string,
): Promise<UserSettingsDocument> {
  const existing = await UserSettingsModel.findOne({ userId, orgId });
  if (existing) {
    return existing;
  }
  try {
    return await UserSettingsModel.create({ userId, orgId });
  } catch (err) {
    // Race: another concurrent request created it first (unique index on
    // {userId, orgId}) — re-read rather than erroring.
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === 11000
    ) {
      const record = await UserSettingsModel.findOne({ userId, orgId });
      if (record) {
        return record;
      }
    }
    throw err;
  }
}

settingsRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const settings = await getOrCreateUserSettings(req.user.id, req.user.orgId);
    res.status(200).json(success(toUserSettingsDTO(settings)));
  }),
);

settingsRouter.patch(
  '/me',
  authenticate,
  validate({ body: updateUserSettingsSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    // Ensure a record exists first, so a PATCH sent before any GET still lands on a
    // fully-defaulted document instead of an upsert with only the patched fields set.
    await getOrCreateUserSettings(req.user.id, req.user.orgId);

    const body = req.body as UpdateUserSettingsInput;
    const updates = flattenToDotNotation(body);

    const updated = await UserSettingsModel.findOneAndUpdate(
      { userId: req.user.id, orgId: req.user.orgId },
      { $set: updates },
      { new: true },
    );
    if (!updated) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update settings');
    }

    res.status(200).json(success(toUserSettingsDTO(updated)));
  }),
);

settingsRouter.get(
  '/defaults',
  asyncHandler(async (_req, res) => {
    res.status(200).json(success(DEFAULT_USER_SETTINGS satisfies UserSettingsDefaults));
  }),
);

// ---------------------------------------------------------------------------------------
// GET/PATCH /global — org-wide GlobalSettings singleton (maxSnapshotArticles, msTeams.*,
// articleFieldMapping.*). Application-Admin-grade: gated on global-settings:manage, unlike
// /me above which any authenticated user can read/write for their own record.
// ---------------------------------------------------------------------------------------

// Same find-then-create shape as getOrCreateUserSettings above — a singleton per org,
// enforced by GlobalSettingsModel's unique index on orgId.
async function getOrCreateGlobalSettings(orgId: string): Promise<GlobalSettingsDocument> {
  const existing = await GlobalSettingsModel.findOne({ orgId });
  if (existing) {
    return existing;
  }
  try {
    return await GlobalSettingsModel.create({ orgId });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const record = await GlobalSettingsModel.findOne({ orgId });
      if (record) {
        return record;
      }
    }
    throw err;
  }
}

settingsRouter.get(
  '/global',
  authenticate,
  orgContext,
  requirePermission('global-settings:manage' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const settings = await getOrCreateGlobalSettings(req.user.orgId);
    res.status(200).json(success(toGlobalSettingsDTO(settings)));
  }),
);

settingsRouter.patch(
  '/global',
  authenticate,
  orgContext,
  requirePermission('global-settings:manage' satisfies Permission),
  validate({ body: updateGlobalSettingsSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    await getOrCreateGlobalSettings(req.user.orgId);

    const body = req.body as UpdateGlobalSettingsInput;
    const updates = flattenToDotNotation(body);

    const updated = await GlobalSettingsModel.findOneAndUpdate(
      { orgId: req.user.orgId },
      { $set: updates },
      { new: true },
    );
    if (!updated) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update global settings');
    }

    // No dedicated 'global-settings' AuditEntityType exists — this is an org-wide config
    // change, so it's filed under 'organization' (same category org.update uses).
    audit(req, {
      action: 'global-settings.update',
      entityType: 'organization',
      entityId: req.user.orgId,
      details: { updatedFields: Object.keys(body) },
    });

    res.status(200).json(success(toGlobalSettingsDTO(updated)));
  }),
);

// ---------------------------------------------------------------------------------------
// GET/PUT /filter-layout — admin-configured LHS filter placement/order/labels. Lives here
// (rather than a standalone filter-layout.routes.ts) because it's gated by the same
// global-settings:manage permission and edited from the same admin settings screen.
// projectId query/body param omitted or null targets the org-wide default layout; a
// specific projectId targets that project's override (see FilterLayout's own doc comment).
// ---------------------------------------------------------------------------------------

const getFilterLayoutQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
});
type GetFilterLayoutQuery = z.infer<typeof getFilterLayoutQuerySchema>;

// Throws 404 for a projectId that doesn't exist (or belongs to another org) — same
// "wrong-org id 404s" convention as every other cross-referenced id in this codebase.
async function assertProjectInOrg(projectId: string, orgId: string): Promise<void> {
  if (
    !mongoose.isValidObjectId(projectId) ||
    !(await ProjectModel.exists({ _id: projectId, orgId }))
  ) {
    throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  }
}

async function getOrCreateFilterLayout(
  orgId: string,
  projectId: string | null,
): Promise<FilterLayoutDocument> {
  const existing = await FilterLayoutModel.findOne({ orgId, projectId });
  if (existing) {
    return existing;
  }
  try {
    return await FilterLayoutModel.create({ orgId, projectId });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const record = await FilterLayoutModel.findOne({ orgId, projectId });
      if (record) {
        return record;
      }
    }
    throw err;
  }
}

settingsRouter.get(
  '/filter-layout',
  authenticate,
  orgContext,
  requirePermission('global-settings:manage' satisfies Permission),
  validate({ query: getFilterLayoutQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const query = req.query as unknown as GetFilterLayoutQuery;
    const projectId = query.projectId ?? null;
    if (projectId !== null) {
      await assertProjectInOrg(projectId, req.user.orgId);
    }

    const layout = await getOrCreateFilterLayout(req.user.orgId, projectId);
    res.status(200).json(success(toFilterLayoutDTO(layout)));
  }),
);

settingsRouter.put(
  '/filter-layout',
  authenticate,
  orgContext,
  requirePermission('global-settings:manage' satisfies Permission),
  validate({ body: updateFilterLayoutSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const body = req.body as UpdateFilterLayoutInput;
    const projectId = body.projectId ?? null;
    if (projectId !== null) {
      await assertProjectInOrg(projectId, req.user.orgId);
    }

    // find-then-create (not a blind upsert), same rationale as getOrCreateUserSettings above.
    await getOrCreateFilterLayout(req.user.orgId, projectId);

    const layout = await FilterLayoutModel.findOneAndUpdate(
      { orgId: req.user.orgId, projectId },
      { $set: { items: body.items } },
      { new: true },
    );
    if (!layout) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update filter layout');
    }

    // Note: the `audit` helper (lib/audit.ts) doesn't yet accept a projectId of its own —
    // the affected project (when this isn't the org-wide default layout) is recorded in
    // `details` instead, alongside the AuditLogEntry.projectId column exposed read-side by
    // GET /api/audit.
    audit(req, {
      action: 'global-settings.update',
      entityType: 'organization',
      entityId: req.user.orgId,
      details: { scope: projectId ?? 'default', ...(projectId ? { projectId } : {}), itemCount: body.items.length },
    });

    res.status(200).json(success(toFilterLayoutDTO(layout)));
  }),
);
