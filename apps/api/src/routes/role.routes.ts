import express from 'express';

import {
  createRoleSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type Permission,
  type UpdateRoleInput,
} from '@content-insights/shared';

import { audit } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ForbiddenError, isDuplicateKeyError } from '../lib/errors.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { success } from '../lib/response.js';
import { toRoleDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { RoleModel } from '../models/role.model.js';
import { UserModel } from '../models/user.model.js';

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
  requirePermission('roles:manage' satisfies Permission),
  validate({ body: createRoleSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { name, permissions } = req.body as CreateRoleInput;

    // Reserved: a custom role can never take over an existing system role's name — checked
    // against this org's live isSystem roles (not the static SYSTEM_ROLE_NAMES list) since
    // a system role's name is itself editable below (only its permissions are locked).
    const systemNameCollision = await RoleModel.findOne({ orgId: req.user.orgId, name, isSystem: true });
    if (systemNameCollision) {
      throw new AppError(
        409,
        'ROLE_NAME_RESERVED',
        `"${name}" is a system role name and cannot be used for a custom role`,
      );
    }

    try {
      const role = await RoleModel.create({
        orgId: req.user.orgId,
        name,
        permissions,
        isSystem: false,
      });
      audit(req, {
        action: 'role.create',
        entityType: 'role',
        entityId: role._id.toString(),
        details: { name, permissions },
      });
      res.status(201).json(success(toRoleDTO(role)));
    } catch (err) {
      if (isDuplicateKeyError(err) && err.keyPattern?.name) {
        throw new AppError(409, 'ROLE_NAME_TAKEN', 'A role with this name already exists');
      }
      throw err;
    }
  }),
);

roleRouter.put(
  '/:id',
  authenticate,
  orgContext,
  requirePermission('roles:manage' satisfies Permission),
  validate({ body: updateRoleSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Role not found', 'ROLE_NOT_FOUND');
    const body = req.body as UpdateRoleInput;

    const existing = await RoleModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!existing) {
      throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
    }
    // System roles' permission sets are fixed by design — only a rename is allowed, never a
    // permissions edit, regardless of who's asking (even an Application Admin).
    if (existing.isSystem && body.permissions !== undefined) {
      throw new ForbiddenError(
        'This is a system role — its permissions cannot be modified (it may still be renamed)',
      );
    }

    try {
      const role = await RoleModel.findOneAndUpdate(
        { _id: id, orgId: req.user.orgId },
        { $set: body },
        { new: true },
      );
      if (!role) {
        throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
      }
      audit(req, {
        action: 'role.update',
        entityType: 'role',
        entityId: id,
        details: { updatedFields: Object.keys(body), ...(body.permissions ? { permissions: body.permissions } : {}) },
      });
      res.status(200).json(success(toRoleDTO(role)));
    } catch (err) {
      if (isDuplicateKeyError(err) && err.keyPattern?.name) {
        throw new AppError(409, 'ROLE_NAME_TAKEN', 'A role with this name already exists');
      }
      throw err;
    }
  }),
);

roleRouter.delete(
  '/:id',
  authenticate,
  orgContext,
  requirePermission('roles:manage' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Role not found', 'ROLE_NOT_FOUND');

    const existing = await RoleModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!existing) {
      throw new AppError(404, 'ROLE_NOT_FOUND', 'Role not found');
    }
    if (existing.isSystem) {
      throw new AppError(403, 'SYSTEM_ROLE_PROTECTED', 'System roles cannot be deleted');
    }

    // Role assignment lives on User.roleAssignments now (not a Group membership array) —
    // a role still granted to anyone must not be deleted out from under them, since that
    // would silently change live authorization decisions.
    const assignmentCount = await UserModel.countDocuments({
      orgId: req.user.orgId,
      'roleAssignments.roleId': id,
    });
    if (assignmentCount > 0) {
      throw new AppError(
        409,
        'ROLE_IN_USE',
        `Role is still assigned to ${assignmentCount} user(s)`,
      );
    }

    await RoleModel.deleteOne({ _id: id, orgId: req.user.orgId });

    audit(req, {
      action: 'role.delete',
      entityType: 'role',
      entityId: id,
      details: { name: existing.name },
    });

    res.status(200).json(success(null));
  }),
);
