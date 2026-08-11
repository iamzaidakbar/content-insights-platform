import type {
  ApiResponse,
  FilterLayout,
  UpdateFilterLayoutInput,
} from '@content-insights/shared';

import { apiClient } from './api-client';

// GET/PUT /api/settings/filter-layout — admin-configured LHS filter placement/order/labels.
// Gated server-side on global-settings:manage, same as global-settings-api.ts. Omitting
// projectId (or passing null/undefined) targets the org-wide default layout; a specific
// projectId targets that project's override — see FilterLayout's own doc comment.

export async function fetchFilterLayout(projectId?: string | null): Promise<FilterLayout> {
  const response = await apiClient.get<ApiResponse<FilterLayout>>('/settings/filter-layout', {
    params: projectId ? { projectId } : undefined,
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function updateFilterLayout(input: UpdateFilterLayoutInput): Promise<FilterLayout> {
  const response = await apiClient.put<ApiResponse<FilterLayout>>('/settings/filter-layout', input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
