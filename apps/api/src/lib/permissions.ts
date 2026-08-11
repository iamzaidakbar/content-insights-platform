import type { Permission, SystemRoleName } from '@content-insights/shared';

import { ForbiddenError, ValidationError } from './errors.js';
import type { AuthenticatedUser } from '../types/express.js';

// The one role name this file deliberately special-cases — see canAssignRole's own
// comment for why "Application Admin" is checked by name here (and nowhere else).
const APPLICATION_ADMIN_ROLE_NAME: SystemRoleName = 'Application Admin';

// ---------------------------------------------------------------------------------------
// Plain global-scope checks — for handlers that don't need group scoping at all (e.g. an
// org-wide-only route gated on a single permission). Scoped checks live in
// middleware/requireScopedPermission.ts and lib/group-scope.ts instead.
// ---------------------------------------------------------------------------------------

export function hasPermission(user: AuthenticatedUser, key: Permission): boolean {
  return user.globalPermissions.includes('*') || user.globalPermissions.includes(key);
}

export function assertPermission(user: AuthenticatedUser, key: Permission): void {
  if (!hasPermission(user, key)) {
    throw new ForbiddenError(`Missing required permission: ${key}`);
  }
}

// ---------------------------------------------------------------------------------------
// Scope-aware effective-permission resolution (business rule 1).
//
// A roleAssignment with groupId: null grants that role's permissions at GLOBAL scope
// ("All"). A roleAssignment with a groupId grants permissions scoped to that group only.
// An assignment only counts while it's active: (!startDate || startDate <= now) &&
// (!endDate || endDate >= now).
//
// Deliberately structural/decoupled from Mongoose: `roles` just needs `_id` + `permissions`
// and `user.roleAssignments` just needs `roleId`/`groupId`/`startDate`/`endDate` — a real
// UserDocument/RoleDocument satisfies this, but so does a plain object (see
// permissions.test.ts), and so does the JWT-derived AuthenticatedUser shape (types/express.ts),
// which is what lets this run identically at JWT-issue time (services/session.service.ts)
// and per-request (middleware/requireScopedPermission.ts, lib/group-scope.ts).
// ---------------------------------------------------------------------------------------

export interface EffectivePermissionsRole {
  _id: { toString(): string };
  permissions: string[];
}

export interface EffectivePermissionsRoleAssignment {
  roleId: { toString(): string };
  groupId: { toString(): string } | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
}

export interface EffectivePermissionsUser {
  roleAssignments: readonly EffectivePermissionsRoleAssignment[];
}

export interface EffectivePermissions {
  // May contain the literal '*' wildcard sentinel rather than every enumerated Permission —
  // every check against these sets (here, requireScopedPermission, group-scope.ts) already
  // does `.has('*') || .has(key)`, so this is behaviorally identical to expanding '*' into
  // the full permission catalog, with far less data to carry around (particularly once this
  // is denormalized into the JWT's globalPermissions).
  global: Set<string>;
  byGroup: Map<string, Set<string>>;
}

export function isRoleAssignmentActive(
  assignment: Pick<EffectivePermissionsRoleAssignment, 'startDate' | 'endDate'>,
  now: Date = new Date(),
): boolean {
  const start = assignment.startDate ? new Date(assignment.startDate) : null;
  const end = assignment.endDate ? new Date(assignment.endDate) : null;
  return (!start || start <= now) && (!end || end >= now);
}

export function resolveEffectivePermissions(
  user: EffectivePermissionsUser,
  roles: EffectivePermissionsRole[],
  now: Date = new Date(),
): EffectivePermissions {
  const roleById = new Map(roles.map((role) => [role._id.toString(), role]));
  const global = new Set<string>();
  const byGroup = new Map<string, Set<string>>();

  for (const assignment of user.roleAssignments) {
    if (!isRoleAssignmentActive(assignment, now)) {
      continue;
    }
    const role = roleById.get(assignment.roleId.toString());
    if (!role) {
      // Assignment references a role that's since been deleted/renamed away — grants
      // nothing rather than throwing, same as any other dangling-reference read.
      continue;
    }

    if (assignment.groupId === null) {
      for (const permission of role.permissions) {
        global.add(permission);
      }
      continue;
    }

    const groupKey = assignment.groupId.toString();
    let groupPermissions = byGroup.get(groupKey);
    if (!groupPermissions) {
      groupPermissions = new Set<string>();
      byGroup.set(groupKey, groupPermissions);
    }
    for (const permission of role.permissions) {
      groupPermissions.add(permission);
    }
  }

  return { global, byGroup };
}

// ---------------------------------------------------------------------------------------
// Business rule 3: only an Application Admin may grant the Application Admin role to
// someone else. This is THE single carve-out in this codebase's otherwise strictly
// permission-based (never role-name-based) authorization model — do not add another
// role-name check anywhere else; route/middleware permission gates (roles:assign, etc.)
// cover every other case.
// ---------------------------------------------------------------------------------------

export interface RoleAssignmentActorContext {
  // e.g. AuthenticatedUser.globalPermissions from the JWT, or a freshly resolved
  // EffectivePermissions.global.
  globalPermissions: Iterable<string>;
  // Names of roles the actor holds at GLOBAL scope (groupId: null), currently active.
  // Not derivable from the JWT alone (role names aren't embedded there, only roleIds — see
  // types/express.ts) — the caller resolves these from the Role documents referenced by the
  // actor's global-scope roleAssignments.
  globalRoleNames: Iterable<string>;
}

export function canAssignRole(
  actingUser: RoleAssignmentActorContext,
  targetRoleName: string,
  targetGroupId: string | null,
): boolean {
  if (targetRoleName !== APPLICATION_ADMIN_ROLE_NAME) {
    return true;
  }
  // Application Admin is always global-scope (see validateRoleAssignmentInput) — a
  // group-scoped attempt is rejected outright regardless of who's asking.
  if (targetGroupId !== null) {
    return false;
  }
  const globalPermissions = new Set(actingUser.globalPermissions);
  const globalRoleNames = new Set(actingUser.globalRoleNames);
  return globalPermissions.has('*') || globalRoleNames.has(APPLICATION_ADMIN_ROLE_NAME);
}

// ---------------------------------------------------------------------------------------
// Business rule 4: Application Admin role assignments are never time-bound and always
// global scope. Later role-assignment routes call this before persisting a new/updated
// roleAssignment.
// ---------------------------------------------------------------------------------------

export interface RoleAssignmentInputLike {
  groupId: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export function validateRoleAssignmentInput(
  targetRoleName: string,
  input: RoleAssignmentInputLike,
): void {
  if (targetRoleName !== APPLICATION_ADMIN_ROLE_NAME) {
    return;
  }
  if (input.groupId !== null || input.startDate != null || input.endDate != null) {
    throw new ValidationError(
      'Application Admin role assignments must be global (groupId: null) and cannot have a startDate/endDate',
    );
  }
}
