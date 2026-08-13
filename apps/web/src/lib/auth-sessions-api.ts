import type { ApiResponse } from '@content-insights/shared';

import { apiClient } from './api-client';

export interface AuthSessionRow {
  jti: string;
  userId: string;
  createdAt: string;
  userAgent?: string;
  ip?: string;
}

export async function fetchAuthSessions(): Promise<AuthSessionRow[]> {
  const response = await apiClient.get<ApiResponse<AuthSessionRow[]>>('/auth/sessions');
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
  return response.data.data;
}

export async function revokeAuthSession(jti: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/auth/sessions/${jti}`);
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}
