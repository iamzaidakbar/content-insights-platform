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

export const USER_PROVISIONING = ['invite_pending', 'local', 'sso'] as const;
export type UserProvisioning = (typeof USER_PROVISIONING)[number];

export interface User {
  id: UserId;
  orgId: OrgId;
  email: string;
  // Optional — omitted entirely (never `undefined`) until the user sets one via
  // PATCH /api/users/me; every existing consumer falls back to deriving a display name
  // from `email` (see apps/web/src/layouts/AppShell.tsx).
  displayName?: string | undefined;
  isActive: boolean;
  provisioning: UserProvisioning;
  lastLoginAt?: string | undefined;
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

// POST /api/users — creates a new User in the caller's org (users:manage). There is no
// outbound email/SMTP, so a one-time invite URL is returned exactly once for the admin to
// copy and share out of band. The created user cannot sign in until they accept the invite.
export interface CreateUserResult {
  user: User;
  inviteUrl: string;
}

export interface InviteLinkResult {
  inviteUrl: string;
}

export interface PasswordResetLinkResult {
  resetUrl: string;
}
