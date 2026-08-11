import type {
  ApiResponse,
  GlobalSettings,
  UpdateGlobalSettingsInput,
} from '@content-insights/shared';

import { apiClient } from './api-client';

// GET/PATCH /api/settings/global — org-wide GlobalSettings singleton (maxSnapshotArticles,
// msTeams.*, articleFieldMapping.*). Gated server-side on the global-settings:manage
// permission, unlike settings-api.ts's /me endpoints which any authenticated user can hit
// for their own record.

export async function fetchGlobalSettings(): Promise<GlobalSettings> {
  const response = await apiClient.get<ApiResponse<GlobalSettings>>('/settings/global');
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function updateGlobalSettings(
  patch: UpdateGlobalSettingsInput,
): Promise<GlobalSettings> {
  const response = await apiClient.patch<ApiResponse<GlobalSettings>>('/settings/global', patch);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
