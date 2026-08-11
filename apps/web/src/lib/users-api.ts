import type {
  ApiResponse,
  CreateUserResult,
  GroupId,
  PaginatedResult,
  RoleAssignmentId,
  RoleId,
  User,
  UserId,
  UserSummary,
} from '@content-insights/shared';

import { apiClient } from './api-client';

// Bounded (max 20) id/email typeahead match list — no `page` param, no permission gate
// beyond org membership. Used for e.g. "assign this user to my group" pickers, where even a
// scoped User Group Admin holding no org-wide users:read grant must still be able to search
// candidates for their own group. An empty/missing `email` returns [] without a request
// round-trip's worth of meaning — the caller decides whether to skip calling this at all.
export async function searchUsers(email: string): Promise<UserSummary[]> {
  const response = await apiClient.get<ApiResponse<UserSummary[]>>('/users', {
    params: { email },
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// Distinct from searchUsers above: passing `page` switches the backend route into its
// org-wide roster mode (gated on 'users:read', full User DTO incl. role assignments) rather
// than the bounded id/email typeahead — see user.routes.ts's GET / for the full branch
// rationale. `email` here narrows the roster by the same case-insensitive substring match.
export async function fetchOrgUsers(page: number, email?: string): Promise<PaginatedResult<User>> {
  const response = await apiClient.get<ApiResponse<PaginatedResult<User>>>('/users', {
    params: { page, ...(email ? { email } : {}) },
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// POST /api/users (users:manage) — the only way to add a member to an existing org besides
// registering a brand-new org or SSO auto-provisioning. There is no outbound email/SMTP
// integration in this app, so the server generates a temporary password and returns it once,
// here, in the response body — it is never retrievable again afterward. The created user
// starts with no role assignments; grant access separately via assignUserRole below.
export interface CreateUserInput {
  email: string;
  displayName?: string;
}

export async function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  const response = await apiClient.post<ApiResponse<CreateUserResult>>('/users', input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// Hard delete (users:delete) — a distinct, more sensitive permission from users:manage.
// 400s if id is the caller's own account (no self-delete, so an org is never left without
// anyone able to administer it).
export async function deleteUser(id: UserId): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/users/${id}`);
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}

// Soft delete (users:delete) — flips isActive to false and revokes all of that user's
// refresh tokens server-side; same no-self-deactivate restriction as deleteUser.
export async function deactivateUser(id: UserId): Promise<User> {
  const response = await apiClient.patch<ApiResponse<User>>(`/users/${id}/deactivate`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// ---------------------------------------------------------------------------------------
// Role-assignment lifecycle (roles:assign, scoped to `groupId` — null means the org-wide
// "All" scope and requires an org-wide grant; a non-null groupId lets a group-scoped holder,
// e.g. a User Group Admin, assign within just that group). Each assignment is its own
// sub-document (RoleAssignment.id) so it can be individually revoked or rescheduled without
// touching the user's other assignments.
// ---------------------------------------------------------------------------------------

export interface AssignUserRoleInput {
  roleId: RoleId;
  groupId: GroupId | null;
  startDate?: string | null;
  endDate?: string | null;
}

export async function assignUserRole(userId: UserId, input: AssignUserRoleInput): Promise<User> {
  const response = await apiClient.post<ApiResponse<User>>(
    `/users/${userId}/role-assignments`,
    input,
  );
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function revokeUserRoleAssignment(
  userId: UserId,
  assignmentId: RoleAssignmentId,
): Promise<User> {
  const response = await apiClient.delete<ApiResponse<User>>(
    `/users/${userId}/role-assignments/${assignmentId}`,
  );
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// "Ends" an assignment by (re)setting its endDate — pass null to clear a previously-set end
// date back to open-ended. roleId/groupId are immutable this way; changing those means
// revokeUserRoleAssignment + assignUserRole instead.
export async function updateRoleAssignmentEndDate(
  userId: UserId,
  assignmentId: RoleAssignmentId,
  endDate: string | null,
): Promise<User> {
  const response = await apiClient.patch<ApiResponse<User>>(
    `/users/${userId}/role-assignments/${assignmentId}`,
    { endDate },
  );
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// PATCH /api/users/me/current-group — switches the caller's "last-selected navbar group"
// (User.currentGroupId), which changes which saved searches/channels/default-query and
// hard/soft filter grants a subsequent search resolves against server-side. Pass null to
// clear it.
export async function setCurrentGroup(groupId: string | null): Promise<User> {
  const response = await apiClient.patch<ApiResponse<User>>('/users/me/current-group', { groupId });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// PATCH /api/users/me/current-project — the project the caller is currently working in;
// also the key ArticlesPage looks up in UserSettings.cardContentLines. Pass null to clear it.
export async function setCurrentProject(projectId: string | null): Promise<User> {
  const response = await apiClient.patch<ApiResponse<User>>('/users/me/current-project', { projectId });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function updateMe(displayName: string): Promise<User> {
  const response = await apiClient.patch<ApiResponse<User>>('/users/me', { displayName });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function deleteMe(): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>('/users/me');
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}
