import type { Request } from 'express';
import mongoose from 'mongoose';

import { resolveEffectivePermissions } from './permissions.js';
import type { GroupIdResolver } from '../middleware/requireScopedPermission.js';
import { DashboardModel } from '../models/dashboard.model.js';
import { RoleModel } from '../models/role.model.js';
import { SavedSearchModel } from '../models/savedSearch.model.js';
import { UserModel } from '../models/user.model.js';
import type { AuthenticatedUser } from '../types/express.js';

export function groupIdFromParam(paramName = 'groupId'): GroupIdResolver {
  return (req: Request): string | null => {
    const value = req.params[paramName];
    return typeof value === 'string' && mongoose.isValidObjectId(value) ? value : null;
  };
}

export function groupIdFromBody(fieldName = 'groupId'): GroupIdResolver {
  return (req: Request): string | null => {
    const value = (req.body as Record<string, unknown> | undefined)?.[fieldName];
    return typeof value === 'string' && mongoose.isValidObjectId(value) ? value : null;
  };
}

export function groupIdFromSavedSearch(paramName = 'id'): GroupIdResolver {
  return async (req: Request): Promise<string | null> => {
    const docId = req.params[paramName];
    if (typeof docId !== 'string' || !mongoose.isValidObjectId(docId) || !req.user) {
      return null;
    }
    const doc = await SavedSearchModel.findOne({ _id: docId, orgId: req.user.orgId }, { groupId: 1 });
    return doc?.groupId ? doc.groupId.toString() : null;
  };
}

export function groupIdFromDashboard(paramName = 'id'): GroupIdResolver {
  return async (req: Request): Promise<string | null> => {
    const docId = req.params[paramName];
    if (typeof docId !== 'string' || !mongoose.isValidObjectId(docId) || !req.user) {
      return null;
    }
    const doc = await DashboardModel.findOne({ _id: docId, orgId: req.user.orgId }, { groupId: 1 });
    return doc?.groupId ? doc.groupId.toString() : null;
  };
}

// Resolves the scope of ONE EXISTING roleAssignment sub-document (by its own _id, not the
// groupId a caller wants to assign into — see groupIdFromBody for that) — used by
// user.routes.ts's DELETE/PATCH .../role-assignments/:assignmentId so a scoped 'roles:assign'
// holder (e.g. a User Group Admin) can only end/reschedule assignments within their own group,
// never one scoped to a different group or to global (groupId: null) scope.
export function groupIdFromUserRoleAssignment(
  userIdParam = 'id',
  assignmentIdParam = 'assignmentId',
): GroupIdResolver {
  return async (req: Request): Promise<string | null> => {
    const userId = req.params[userIdParam];
    const assignmentId = req.params[assignmentIdParam];
    if (
      typeof userId !== 'string' ||
      typeof assignmentId !== 'string' ||
      !mongoose.isValidObjectId(userId) ||
      !mongoose.isValidObjectId(assignmentId) ||
      !req.user
    ) {
      return null;
    }
    const user = await UserModel.findOne(
      { _id: userId, orgId: req.user.orgId, 'roleAssignments._id': assignmentId },
      { 'roleAssignments.$': 1 },
    );
    const assignment = user?.roleAssignments[0];
    return assignment?.groupId ? assignment.groupId.toString() : null;
  };
}

export type DocumentScopeFilter =
  | { orgWide: true; allowedGroupIds: null }
  | { orgWide: false; allowedGroupIds: string[] };

// Used by routes like insight.routes.ts/userTag.routes.ts (and dashboard.routes.ts's
// resolveDocumentScope-based listing) to extend an org-wide-only permission check so a user
// whose grant is group-scoped-only (no org-wide grant) can still list/search within the
// group(s) where their role grants it. One bounded query (cost scales with the number of
// distinct roleIds the user holds, not resource/group count), not a new pagination/index
// design. Article listing itself now goes through lib/article-access.ts's
// resolveArticleSearchGrants instead (see that file's own comment on why it stays
// self-contained rather than reusing this).
//
// Trusts req.user.roleAssignments' scope (groupId) and time bounds straight from the JWT
// (see AccessTokenRoleAssignment's comment in lib/jwt.ts), but always re-fetches the
// referenced Role documents fresh, since a role's permission list can be edited
// (roles:manage) independently of any token's 15-minute lifetime.
export async function resolveDocumentScope(
  user: AuthenticatedUser,
  permissionKey: string,
): Promise<DocumentScopeFilter> {
  if (user.globalPermissions.includes('*') || user.globalPermissions.includes(permissionKey)) {
    return { orgWide: true, allowedGroupIds: null };
  }

  const roleIds = Array.from(new Set(user.roleAssignments.map((assignment) => assignment.roleId)));
  if (roleIds.length === 0) {
    return { orgWide: false, allowedGroupIds: [] };
  }

  const roles = await RoleModel.find({ _id: { $in: roleIds }, orgId: user.orgId });
  const effective = resolveEffectivePermissions(user, roles);

  const allowedGroupIds = Array.from(effective.byGroup.entries())
    .filter(([, permissions]) => permissions.has('*') || permissions.has(permissionKey))
    .map(([groupId]) => groupId);

  return { orgWide: false, allowedGroupIds };
}

// A yes/no version of resolveDocumentScope for routes that already have one specific
// groupId in hand (not a list to filter) and just need "does this user hold `permissionKey`
// on this group" — e.g. SavedSearch/Dashboard routes, where which permission key applies is
// state-dependent (owner vs. non-owner, isChannel or not) and so can't be expressed as a
// single fixed requireScopedPermission call.
export async function hasGroupPermission(
  user: AuthenticatedUser,
  permissionKey: string,
  groupId: string,
): Promise<boolean> {
  const scope = await resolveDocumentScope(user, permissionKey);
  return scope.orgWide || scope.allowedGroupIds.includes(groupId);
}
