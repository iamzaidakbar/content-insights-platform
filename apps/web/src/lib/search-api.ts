import type { ApiResponse, FacetsResponse, FilterPanelState, SearchResponse } from '@content-insights/shared';

import { apiClient } from './api-client';

// The whole active-filter shape (query, source-type tab, hidden-articles mode, date
// filter, project scope, taxonomy values, user tags, Advanced Search, sort) travels as one
// FilterPanelState object — filterPanelStateSchema on the server is `.strict()` with no
// optional top-level fields (dateFilter is nullable, not optional), so callers should build
// this from EMPTY_FILTER_PANEL_STATE and override just what changed rather than
// hand-assembling a partial object.

export interface RunSearchParams {
  filters: FilterPanelState;
  page: number;
  size: number;
}

export async function searchArticles(params: RunSearchParams): Promise<SearchResponse> {
  const response = await apiClient.post<ApiResponse<SearchResponse>>('/search', params);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// Live facet counts for the filter panel — same filters shape as searchArticles, but no
// page/size (the server returns full per-concept bucket counts, not paged hits).
export async function fetchSearchFacets(filters: FilterPanelState): Promise<FacetsResponse> {
  const response = await apiClient.post<ApiResponse<FacetsResponse>>('/search/facets', { filters });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
