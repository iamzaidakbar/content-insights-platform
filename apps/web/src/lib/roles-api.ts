import type { ApiResponse, Permission, Role, RoleId } from '@content-insights/shared';

import { apiClient } from './api-client';

export async function fetchRoles(): Promise<Role[]> {
  const response = await apiClient.get<ApiResponse<Role[]>>('/roles');
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export interface CreateRoleInput {
  name: string;
  permissions: Permission[];
}

export async function createRole(input: CreateRoleInput): Promise<Role> {
  const response = await apiClient.post<ApiResponse<Role>>('/roles', input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// A system role (isSystem: true) may still be renamed here — only its permissions are
// locked (the API 403s a permissions edit against a system role, ForbiddenError, but allows
// name-only updates through unchanged).
export interface UpdateRoleInput {
  name?: string;
  permissions?: Permission[];
}

export async function updateRole(id: RoleId, input: UpdateRoleInput): Promise<Role> {
  const response = await apiClient.put<ApiResponse<Role>>(`/roles/${id}`, input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// 403 SYSTEM_ROLE_PROTECTED if isSystem; 409 ROLE_IN_USE if still assigned to any user.
export async function deleteRole(id: RoleId): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/roles/${id}`);
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}
