import type { GroupId, OrgId, ProjectId, RoleAssignmentId, RoleId, UserId } from '../ids.js';

export interface RoleAssignment {
  id: RoleAssignmentId;
  roleId: RoleId;
  roleName: string; // denormalized
  groupId: GroupId | null; // null = "All" (global) scope
  groupName?: string | null;
  startDate?: string | null;
  endDate?: string | null; // time-bound except Application Admin, which is never time-bound
}

export interface User {
  id: UserId;
  orgId: OrgId;
  email: string;
  // Optional — omitted entirely (never `undefined`) until the user sets one via
  // PATCH /api/users/me; every existing consumer falls back to deriving a display name
  // from `email` (see apps/web/src/layouts/AppShell.tsx).
  displayName?: string | undefined;
  isActive: boolean;
  roleAssignments: RoleAssignment[];
  currentGroupId?: GroupId | null; // last-selected navbar group; Application Admins may have none
  currentProjectId?: ProjectId | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserSummary {
  id: UserId;
  email: string;
  displayName?: string | undefined;
}

// POST /api/users — creates a new User directly in the caller's org (users:manage). There is
// no outbound email/SMTP integration in this app, so the server-generated temporary password
// is returned exactly once, here, in the create response; it is never retrievable again
// afterward (only passwordHash is persisted) — the caller is responsible for communicating it
// to the new user out of band.
export interface CreateUserResult {
  user: User;
  temporaryPassword: string;
}
