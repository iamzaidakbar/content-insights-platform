import express from 'express';

import { createRoleSchema, type Permission } from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError, isDuplicateKeyError } from '../lib/errors.js';
import { success } from '../lib/response.js';
import { toRoleDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { RoleModel } from '../models/role.model.js';

export const roleRouter = express.Router();

roleRouter.get(
  '/',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const roles = await RoleModel.find({ orgId: req.user.orgId }).sort({ name: 1 });
    res.status(200).json(success(roles.map(toRoleDTO)));
  }),
);

roleRouter.post(
  '/',
  authenticate,
  orgContext,
  requirePermission('org:admin' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const parsed = createRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request body');
    }
    const { name, permissions } = parsed.data;

    try {
      const role = await RoleModel.create({ orgId: req.user.orgId, name, permissions });
      res.status(201).json(success(toRoleDTO(role)));
    } catch (err) {
      if (isDuplicateKeyError(err) && err.keyPattern?.name) {
        throw new AppError(409, 'ROLE_NAME_TAKEN', 'A role with this name already exists');
      }
      throw err;
    }
  }),
);
