import type { ApiResponse, UserSettings, UserSettingsDefaults } from '@content-insights/shared';

import { apiClient } from './api-client';

export async function fetchMySettings(): Promise<UserSettings> {
  const response = await apiClient.get<ApiResponse<UserSettings>>('/settings/me');
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// Deliberately `unknown` rather than a typed deep-partial: the patch is built generically
// from a single (path, value) pair by lib/nested-path.ts's pathToPatch, which can't know
// the exact literal shape at the call site. The server is the source of truth for
// validation (zod, field-level 400s) — this is just the wire shape.
export async function updateMySettings(patch: Record<string, unknown>): Promise<UserSettings> {
  const response = await apiClient.patch<ApiResponse<UserSettings>>('/settings/me', patch);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function fetchDefaultSettings(): Promise<UserSettingsDefaults> {
  const response = await apiClient.get<ApiResponse<UserSettingsDefaults>>('/settings/defaults');
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
