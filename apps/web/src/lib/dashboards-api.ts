import type {
  ApiResponse,
  CreateDashboardInput,
  Dashboard,
  DashboardLayoutItemInput,
  PaginatedResult,
  UpdateDashboardInput,
} from '@content-insights/shared';

import { apiClient } from './api-client';

// No groupId filter param — dashboard.routes.ts's GET / resolves visible groups itself from
// the caller's 'dashboards:read' grants (org-wide or per-group); projectId is the only
// caller-supplied narrowing filter.
export async function fetchDashboards(projectId?: string, page = 1): Promise<PaginatedResult<Dashboard>> {
  const response = await apiClient.get<ApiResponse<PaginatedResult<Dashboard>>>('/dashboards', {
    params: { ...(projectId ? { projectId } : {}), page },
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function fetchDashboard(id: string): Promise<Dashboard> {
  const response = await apiClient.get<ApiResponse<Dashboard>>(`/dashboards/${id}`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// A dashboard always starts empty (createDashboardSchema carries no insightIds) — insights are
// attached afterward via addDashboardInsight (or in bulk via updateDashboard's insightIds).
export async function createDashboard(input: CreateDashboardInput): Promise<Dashboard> {
  const response = await apiClient.post<ApiResponse<Dashboard>>('/dashboards', input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// Bulk replace: name and/or the full insightIds set (max DASHBOARD_MAX_INSIGHTS) and/or the
// full layout. Prefer addDashboardInsight/removeDashboardInsight for single-insight changes —
// this overwrites whichever of insightIds/layout is provided wholesale.
export async function updateDashboard(id: string, input: UpdateDashboardInput): Promise<Dashboard> {
  const response = await apiClient.put<ApiResponse<Dashboard>>(`/dashboards/${id}`, input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function deleteDashboard(id: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/dashboards/${id}`);
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}

// PUT /:id/layout — replaces the full layout grid in one call; every insightId in `layout`
// must already be attached to the dashboard (a stray reference 400s server-side).
export async function setDashboardLayout(id: string, layout: DashboardLayoutItemInput[]): Promise<Dashboard> {
  const response = await apiClient.put<ApiResponse<Dashboard>>(`/dashboards/${id}/layout`, { layout });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// POST /:id/insights — attach one more insight (409 DASHBOARD_INSIGHT_EXISTS if already
// attached, 400 DASHBOARD_INSIGHT_LIMIT at DASHBOARD_MAX_INSIGHTS).
export async function addDashboardInsight(id: string, insightId: string): Promise<Dashboard> {
  const response = await apiClient.post<ApiResponse<Dashboard>>(`/dashboards/${id}/insights`, { insightId });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// DELETE /:id/insights/:insightId — also drops that insight's layout row server-side.
export async function removeDashboardInsight(id: string, insightId: string): Promise<Dashboard> {
  const response = await apiClient.delete<ApiResponse<Dashboard>>(`/dashboards/${id}/insights/${insightId}`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
