import type {
  AggregationResult,
  ApiResponse,
  ChartType,
  CreateInsightInput,
  Insight,
  PaginatedResult,
  UpdateInsightInput,
} from '@content-insights/shared';

import { apiClient } from './api-client';

// "own + org-admin-all" — see insight.routes.ts's GET /: every caller sees the insights they
// created; an org:admin additionally sees every insight in the org. No groupId/projectId
// filter param exists on this endpoint (unlike /dashboards) — ownership is the whole story.
export async function fetchInsights(page = 1): Promise<PaginatedResult<Insight>> {
  const response = await apiClient.get<ApiResponse<PaginatedResult<Insight>>>('/insights', {
    params: { page },
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function fetchInsight(id: string): Promise<Insight> {
  const response = await apiClient.get<ApiResponse<Insight>>(`/insights/${id}`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function createInsight(input: CreateInsightInput): Promise<Insight> {
  const response = await apiClient.post<ApiResponse<Insight>>('/insights', input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function updateInsight(id: string, input: UpdateInsightInput): Promise<Insight> {
  const response = await apiClient.put<ApiResponse<Insight>>(`/insights/${id}`, input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// Blocked server-side (409 INSIGHT_IN_USE) while any dashboard still references this insight —
// callers should surface that message rather than assume delete always succeeds.
export async function deleteInsight(id: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/insights/${id}`);
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}

// ---------------------------------------------------------------------------
// GET /:id/data — chart-ready aggregation buckets
// ---------------------------------------------------------------------------
// Response shape mirrors insight.routes.ts's own route-local (not part of the shared
// package) InsightDataResponse interface. This supersedes the old POST /api/search/aggregate
// endpoint (removed in the Content Insights pivot — see the now-deleted aggregations-api.ts):
// chart data is always fetched via a saved Insight's own id now, never an ad-hoc aggregation
// request, so this is the one "fetch chart data" call site.
export interface InsightDataResponse {
  insightId: string;
  chartType: ChartType;
  total: number;
  took: number;
  // wordCloud insights come back as a single { name: 'words', buckets } entry; every other
  // chart type returns one bucket set per configured field mapping, named after its role
  // (e.g. 'category', 'x', 'y', 'series', 'sourceNode') — see insight.routes.ts.
  aggregations: AggregationResult[];
}

export async function fetchInsightData(id: string): Promise<InsightDataResponse> {
  const response = await apiClient.get<ApiResponse<InsightDataResponse>>(`/insights/${id}/data`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
