import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { asyncHandler } from '../lib/async-handler.js';
import { ForbiddenError } from '../lib/errors.js';
import { resolveEffectivePermissions } from '../lib/permissions.js';
import { RoleModel } from '../models/role.model.js';

export type GroupIdResolver = (req: Request) => Promise<string | null> | string | null;

// Extends requirePermission with a scope dimension. Fast path (org-wide grant, JWT-baked,
// zero DB hits) is identical in cost to plain requirePermission — only a user with NO
// org-wide grant falls through to a live lookup. This tradeoff (org-wide stays token-fast,
// group-scoped always hits the DB) is deliberate: group-scoped routes are low-QPS
// admin/single-resource operations, not the hot list/search path (see lib/group-scope.ts's
// resolveDocumentScope for that path instead).
//
// The slow path trusts req.user.roleAssignments' scope (groupId) and time bounds straight
// from the JWT (see AccessTokenRoleAssignment's comment in lib/jwt.ts — those live on the
// User document itself, refreshed every login/refresh) but always re-fetches the referenced
// Role documents fresh, since a role's permission list can be edited (roles:manage)
// independently of any token's 15-minute lifetime.
export function requireScopedPermission(
  permissionKey: string,
  resolveGroupId: GroupIdResolver,
): RequestHandler {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      next(new ForbiddenError(`Missing required permission: ${permissionKey}`));
      return;
    }

    if (user.globalPermissions.includes('*') || user.globalPermissions.includes(permissionKey)) {
      next();
      return;
    }

    const groupId = await resolveGroupId(req);
    if (!groupId) {
      next(new ForbiddenError(`Missing required permission: ${permissionKey}`));
      return;
    }

    const roleIds = Array.from(new Set(user.roleAssignments.map((assignment) => assignment.roleId)));
    const roles = roleIds.length > 0 ? await RoleModel.find({ _id: { $in: roleIds }, orgId: user.orgId }) : [];
    const effective = resolveEffectivePermissions(user, roles);
    const groupPermissions = effective.byGroup.get(groupId);
    if (!groupPermissions || !(groupPermissions.has('*') || groupPermissions.has(permissionKey))) {
      next(new ForbiddenError(`Missing required permission: ${permissionKey}`));
      return;
    }

    next();
  });
}
