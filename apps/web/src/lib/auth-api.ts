import type { ApiResponse } from '@content-insights/shared';

import { apiClient } from './api-client';

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const response = await apiClient.post<ApiResponse<null>>('/auth/change-password', input);
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}
