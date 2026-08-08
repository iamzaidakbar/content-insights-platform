import express from 'express';

import {
  updateOrganizationSchema,
  type OrganizationDetail,
  type Permission,
  type UpdateOrganizationInput,
} from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { success } from '../lib/response.js';
import { toOrganizationDetailDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { OrganizationModel } from '../models/organization.model.js';
import { UserModel } from '../models/user.model.js';

export const organizationRouter = express.Router();

// A caller can only ever address their OWN org through this router — the :orgId path
// param must match req.user.orgId or the request 404s, same "wrong-org id 404s, never
// 403s" convention every other org-scoped resource id in a URL follows in this codebase.
function assertOwnOrg(orgId: string, callerOrgId: string): void {
  if (orgId !== callerOrgId) {
    throw new AppError(404, 'ORG_NOT_FOUND', 'Organization not found');
  }
}

// No permission gate beyond org membership (matches GET /api/projects, GET /api/roles) —
// only PATCH is org:admin-only.
organizationRouter.get(
  '/:orgId',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const orgId = parseObjectIdParam(req.params.orgId, 'Organization not found', 'ORG_NOT_FOUND');
    assertOwnOrg(orgId, req.user.orgId);

    const [org, memberCount] = await Promise.all([
      OrganizationModel.findById(req.user.orgId),
      UserModel.countDocuments({ orgId: req.user.orgId }),
    ]);
    if (!org) {
      throw new AppError(404, 'ORG_NOT_FOUND', 'Organization not found');
    }

    res.status(200).json(success(toOrganizationDetailDTO(org, memberCount) satisfies OrganizationDetail));
  }),
);

organizationRouter.patch(
  '/:orgId',
  authenticate,
  orgContext,
  requirePermission('org:admin' satisfies Permission),
  validate({ body: updateOrganizationSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const orgId = parseObjectIdParam(req.params.orgId, 'Organization not found', 'ORG_NOT_FOUND');
    assertOwnOrg(orgId, req.user.orgId);

    const { name } = req.body as UpdateOrganizationInput;
    const [org, memberCount] = await Promise.all([
      OrganizationModel.findByIdAndUpdate(req.user.orgId, { name }, { new: true }),
      UserModel.countDocuments({ orgId: req.user.orgId }),
    ]);
    if (!org) {
      throw new AppError(404, 'ORG_NOT_FOUND', 'Organization not found');
    }

    res.status(200).json(success(toOrganizationDetailDTO(org, memberCount) satisfies OrganizationDetail));
  }),
);
