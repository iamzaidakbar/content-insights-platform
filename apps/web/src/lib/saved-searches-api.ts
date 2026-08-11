import type {
  Article,
  ApiResponse,
  FilterPanelState,
  GroupDefaultQuery,
  PaginatedResult,
  SavedSearch,
  SavedSearchType,
} from '@content-insights/shared';

import { apiClient } from './api-client';

function unwrap<T>(body: ApiResponse<T>): T {
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// ---------------------------------------------------------------------------------------
// List / CRUD — mirrors apps/api/src/routes/savedSearch.routes.ts exactly. Field names below
// match createSavedSearchSchema/updateSavedSearchSchema in
// packages/shared/src/validators/saved-search.schema.ts verbatim (no invented fields): a
// saved search is `{ groupId, name, type, filters }`, not the pre-pivot `{ groupId, name,
// params }` shape some not-yet-updated pages still reference.
// ---------------------------------------------------------------------------------------

export type SavedSearchListScope = 'mine' | 'channels';

/** Query param used by /saved-searches (and deep links) to open Articles with a saved search applied. */
export const ARTICLES_LOAD_SAVED_SEARCH_PARAM = 'savedSearch';

// NOTE: this covers GET /saved-searches?scope=channels, which returns plain SavedSearch rows
// (no per-viewer state). For the richer, viewer-state-aware channel listing (sort by last
// viewed, "has new articles" badge, etc.) use fetchChannels in ./channels-api instead — that
// hits GET /channels, a different endpoint with a different response shape
// (SavedSearchWithViewerState).
export async function fetchSavedSearches(
  scope: SavedSearchListScope,
  groupId?: string,
  page = 1,
): Promise<PaginatedResult<SavedSearch>> {
  const response = await apiClient.get<ApiResponse<PaginatedResult<SavedSearch>>>('/saved-searches', {
    params: { scope, ...(groupId ? { groupId } : {}), page },
  });
  return unwrap(response.data);
}

export interface CreateSavedSearchInput {
  groupId: string;
  name: string;
  type?: SavedSearchType; // omit for the server default ('dynamic')
  filters: FilterPanelState;
}

export async function createSavedSearch(input: CreateSavedSearchInput): Promise<SavedSearch> {
  const response = await apiClient.post<ApiResponse<SavedSearch>>('/saved-searches', input);
  return unwrap(response.data);
}

// The GET /:id "load" shape is NOT a bare SavedSearch: for a dynamic search it's the stored
// filters handed back unchanged (relative dates like lastNDays resolve later, at actual query
// time); for a snapshot it's the frozen locationHash set resolved into real articles. This
// union mirrors apps/api's LoadedSavedSearch + ArticlePage merge exactly (see
// savedSearch.service.ts's loadSavedSearch and the GET /:id route) — it's API-internal, not
// part of the canonical packages/shared contract, so it's re-declared here rather than
// invented from scratch.
export type SavedSearchLoadResult =
  | { type: 'dynamic'; filters: FilterPanelState }
  | { type: 'snapshot'; filters: FilterPanelState; locationHashes: string[]; items: Article[]; total: number };

export interface LoadSavedSearchResult {
  savedSearch: SavedSearch;
  result: SavedSearchLoadResult;
}

export async function fetchSavedSearch(id: string): Promise<LoadSavedSearchResult> {
  const response = await apiClient.get<ApiResponse<LoadSavedSearchResult>>(`/saved-searches/${id}`);
  return unwrap(response.data);
}

export interface UpdateSavedSearchInput {
  name?: string;
  // Including `filters` on a `type: 'snapshot'` search is what triggers re-validating the
  // snapshot cap / missing-hash rules and recapturing snapshotLocationHashes server-side —
  // see updateSavedSearchSchema's own comment. A rename-only call (filters omitted) never
  // touches the frozen snapshot.
  filters?: FilterPanelState;
}

export async function updateSavedSearch(id: string, input: UpdateSavedSearchInput): Promise<SavedSearch> {
  const response = await apiClient.put<ApiResponse<SavedSearch>>(`/saved-searches/${id}`, input);
  return unwrap(response.data);
}

// Soft delete (frees the name back up). Rejected with 409 SAVED_SEARCH_IS_DEFAULT if a
// GroupDefaultQuery still points at this saved search — getApiErrorMessage surfaces that
// message as-is, it's already human-readable.
export async function deleteSavedSearch(id: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/saved-searches/${id}`);
  unwrap(response.data);
}

// ---------------------------------------------------------------------------------------
// Sharing into groups — the ONLY action that expands a saved search's visibility beyond its
// base owner/admin-tier/current-group-default rules. Exposing something as a channel
// (below) never does this on its own.
// ---------------------------------------------------------------------------------------

export async function shareSavedSearch(id: string, groupIds: string[]): Promise<SavedSearch> {
  const response = await apiClient.post<ApiResponse<SavedSearch>>(`/saved-searches/${id}/share`, { groupIds });
  return unwrap(response.data);
}

export async function revokeSavedSearchShare(id: string, groupId: string): Promise<SavedSearch> {
  const response = await apiClient.delete<ApiResponse<SavedSearch>>(`/saved-searches/${id}/share/${groupId}`);
  return unwrap(response.data);
}

// ---------------------------------------------------------------------------------------
// Expose / demote as a channel. Two distinct endpoints (not a single toggle), each requiring
// its own explicit `isChannel` literal in the body per setChannelSchema's superRefine
// (channelName is required alongside `isChannel: true`).
// ---------------------------------------------------------------------------------------

export async function exposeSavedSearchChannel(id: string, channelName: string): Promise<SavedSearch> {
  const response = await apiClient.post<ApiResponse<SavedSearch>>(`/saved-searches/${id}/expose-channel`, {
    isChannel: true,
    channelName,
  });
  return unwrap(response.data);
}

export async function demoteSavedSearchChannel(id: string): Promise<SavedSearch> {
  const response = await apiClient.post<ApiResponse<SavedSearch>>(`/saved-searches/${id}/demote-channel`, {
    isChannel: false,
  });
  return unwrap(response.data);
}

// ---------------------------------------------------------------------------------------
// Run — this is BOTH "mark as run" (lastRunAt + newResultsCount, the channel new-articles
// bookkeeping) AND the actual query execution, in one round trip. Response is NOT a
// SearchResponse (that's the /search endpoint's shape) — it's `{ hits: Article[], total }`,
// matching apps/api's RunSavedSearchResult exactly.
// ---------------------------------------------------------------------------------------

export interface RunSavedSearchResult {
  hits: Article[];
  total: number;
}

export interface RunSavedSearchResponse {
  savedSearch: SavedSearch;
  results: RunSavedSearchResult;
}

export async function runSavedSearch(id: string, page = 1, size = 20): Promise<RunSavedSearchResponse> {
  const response = await apiClient.post<ApiResponse<RunSavedSearchResponse>>(`/saved-searches/${id}/run`, {
    page,
    size,
  });
  return unwrap(response.data);
}

// ---------------------------------------------------------------------------------------
// Export — the query DEFINITION (filters), not a re-run of results.
// ---------------------------------------------------------------------------------------

export interface ExportSavedSearchResult {
  id: string;
  name: string;
  type: SavedSearchType;
  filters: FilterPanelState;
  snapshotArticleCount?: number; // present only when type === 'snapshot'
  snapshotLocationHashes?: string[]; // present only when type === 'snapshot'
  exportedAt: string;
}

export async function exportSavedSearchQuery(id: string): Promise<ExportSavedSearchResult> {
  const response = await apiClient.get<ApiResponse<ExportSavedSearchResult>>(`/saved-searches/${id}/export`);
  return unwrap(response.data);
}

// ---------------------------------------------------------------------------------------
// Group default query — the saved search a group's members land on for a given project.
// These live on group.routes.ts (PUT/DELETE /groups/:id/default-query), not
// saved-search.routes.ts, but are kept here rather than in groups-api.ts since they're
// fundamentally about which SAVED SEARCH is the default, not general group management.
// ---------------------------------------------------------------------------------------

export interface SetGroupDefaultQueryInput {
  projectId: string;
  // Passing null clears the default for that project via this same PUT endpoint (the server
  // short-circuits to a delete-and-return-null) — functionally identical to
  // clearGroupDefaultQuery below, offered here for callers that already have a nullable
  // savedSearchId in hand (e.g. a "default search" <select>) and would rather not branch.
  savedSearchId: string | null;
}

export async function setGroupDefaultQuery(
  groupId: string,
  input: SetGroupDefaultQueryInput,
): Promise<GroupDefaultQuery | null> {
  const response = await apiClient.put<ApiResponse<GroupDefaultQuery | null>>(
    `/groups/${groupId}/default-query`,
    input,
  );
  return unwrap(response.data);
}

// Always allowed, no "still referenced" guard (that rule only blocks deleting the SAVED
// SEARCH itself while it remains a default — see deleteSavedSearch above).
export async function clearGroupDefaultQuery(groupId: string, projectId: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/groups/${groupId}/default-query/${projectId}`);
  unwrap(response.data);
}
