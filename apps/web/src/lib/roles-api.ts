import type { ApiResponse, Permission, Role } from '@content-insights/shared';

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
