import type { Group, Permission, Role, RoleAssignment, UserId } from '@content-insights/shared';

// Mirrors the backend's requireScopedPermission/resolveDocumentScope model on the client:
// an org-wide grant (JWT-baked, in `orgWidePermissions`) always wins; otherwise the check
// falls back to the caller's membership + role *on this specific group*. Needed because a
// Group Admin's `users:manage` grant is typically scoped-only (via GroupMember.roleId) and
// never appears in the org-wide `permissions` array the JWT carries — a plain
// `permissions.includes(...)` check would incorrectly hide management UI from them.
export function hasScopedPermission(
  group: Pick<Group, 'members'>,
  roles: Role[],
  userId: UserId,
  orgWidePermissions: string[],
  permission: Permission,
): boolean {
  if (orgWidePermissions.includes('*') || orgWidePermissions.includes(permission)) {
    return true;
  }
  const membership = group.members.find((member) => member.userId === userId);
  if (!membership) {
    return false;
  }
  const role = roles.find((candidate) => candidate.id === membership.roleId);
  return role ? role.permissions.includes('*') || role.permissions.includes(permission) : false;
}

// ---------------------------------------------------------------------------------------
// Role-assignment client mirrors of apps/api/src/lib/permissions.ts — kept in lockstep with
// that file's isRoleAssignmentActive/canAssignRole so the UI can disable/explain an
// unreachable action up front (e.g. the "All (global)" scope option when granting
// Application Admin) instead of letting the request 403 silently.
// ---------------------------------------------------------------------------------------

export const APPLICATION_ADMIN_ROLE_NAME = 'Application Admin';

export function isRoleAssignmentActive(
  assignment: Pick<RoleAssignment, 'startDate' | 'endDate'>,
  now: Date = new Date(),
): boolean {
  const start = assignment.startDate ? new Date(assignment.startDate) : null;
  const end = assignment.endDate ? new Date(assignment.endDate) : null;
  return (!start || start <= now) && (!end || end >= now);
}

// Mirrors canAssignRole (apps/api/src/lib/permissions.ts) exactly: only an Application Admin
// may grant the Application Admin role, and it is always global scope (groupId: null) — a
// group-scoped attempt is never allowed, regardless of who's asking.
export function canAssignRole(
  actorRoleAssignments: readonly Pick<RoleAssignment, 'groupId' | 'roleName' | 'startDate' | 'endDate'>[],
  actorPermissions: readonly string[],
  targetRoleName: string,
  targetGroupId: string | null,
): boolean {
  if (targetRoleName !== APPLICATION_ADMIN_ROLE_NAME) {
    return true;
  }
  if (targetGroupId !== null) {
    return false;
  }
  if (actorPermissions.includes('*')) {
    return true;
  }
  return actorRoleAssignments.some(
    (assignment) =>
      assignment.groupId === null &&
      assignment.roleName === APPLICATION_ADMIN_ROLE_NAME &&
      isRoleAssignmentActive(assignment),
  );
}
