import type { ApiResponse, UserSummary } from '@content-insights/shared';

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
