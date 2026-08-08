import type { ApiResponse, User, UserSummary } from '@content-insights/shared';

import { apiClient } from './api-client';

export async function searchUsers(query: string): Promise<UserSummary[]> {
  const response = await apiClient.get<ApiResponse<UserSummary[]>>('/users', {
    params: { search: query },
  });
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
