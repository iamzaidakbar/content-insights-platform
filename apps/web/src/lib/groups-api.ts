import type {
  ApiResponse,
  Group,
  GroupDefaultQuery,
  GroupId,
  PaginatedResult,
} from '@content-insights/shared';

import { apiClient } from './api-client';

export async function fetchGroups(page = 1): Promise<PaginatedResult<Group>> {
  const response = await apiClient.get<ApiResponse<PaginatedResult<Group>>>('/groups', {
    params: { page },
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// Walks every page — used by admin pickers (role-assignment scope, Data Access's Projects
// tab counterpart) that need the complete org roster of groups to choose from, not one
// page's worth. Group counts are admin-configured and small in practice, same tradeoff
// GroupDetailPage/SavedQueriesModal already make for an unpaginated groups fetch.
export async function fetchAllGroups(): Promise<Group[]> {
  const first = await fetchGroups(1);
  if (first.totalPages <= 1) {
    return first.items;
  }
  const rest = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, index) => fetchGroups(index + 2)),
  );
  return [...first.items, ...rest.flatMap((result) => result.items)];
}

export async function fetchGroup(id: GroupId): Promise<Group> {
  const response = await apiClient.get<ApiResponse<Group>>(`/groups/${id}`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// Container CRUD (groups:manage) — data access (below) is a separate, more granular
// permission (groups:manageDataAccess) that can be scoped to a single group, so it's split
// into its own set of sub-resource endpoints rather than folded in here.
export interface CreateGroupInput {
  name: string;
  description?: string;
}

export async function createGroup(input: CreateGroupInput): Promise<Group> {
  const response = await apiClient.post<ApiResponse<Group>>('/groups', input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
}

export async function updateGroup(id: GroupId, input: UpdateGroupInput): Promise<Group> {
  const response = await apiClient.put<ApiResponse<Group>>(`/groups/${id}`, input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function deleteGroup(id: GroupId): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/groups/${id}`);
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}

// ---------------------------------------------------------------------------------------
// Data access sub-resource (groups:manageDataAccess). Group.members has no corresponding
// endpoints here — it's a read-model the API derives from User.roleAssignments, never a
// stored field on Group itself (see Group.members's own comment in @content-insights/shared)
// — membership changes go through users-api.ts's role-assignment lifecycle functions
// instead, targeting the User being added/removed with this group's id.
// ---------------------------------------------------------------------------------------

export async function updateGroupProjects(id: GroupId, projectIds: string[]): Promise<Group> {
  const response = await apiClient.put<ApiResponse<Group>>(`/groups/${id}/data-access/projects`, {
    projectIds,
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export interface UpdateGroupHardFilterGrantInput {
  conceptId: string;
  // Required by the backend's validator even though it isn't persisted — hardFilterGrants[].
  // conceptName is always denormalized fresh from the live Concept when a Group is
  // serialized (see group.routes.ts's resolveConceptNamesById), never trusted from the
  // request body. Send the concept's current display name here regardless.
  conceptName: string;
  allowedValues: string[];
  denialNote?: string;
}

export async function updateGroupHardFilters(
  id: GroupId,
  hardFilterGrants: UpdateGroupHardFilterGrantInput[],
): Promise<Group> {
  const response = await apiClient.put<ApiResponse<Group>>(
    `/groups/${id}/data-access/hard-filters`,
    { hardFilterGrants },
  );
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export interface UpdateGroupSoftFilterGrantInput {
  conceptId: string;
  // Same "required but not persisted" note as UpdateGroupHardFilterGrantInput.conceptName.
  conceptName: string;
  order: number;
}

export async function updateGroupSoftFilters(
  id: GroupId,
  softFilterConcepts: UpdateGroupSoftFilterGrantInput[],
): Promise<Group> {
  const response = await apiClient.put<ApiResponse<Group>>(
    `/groups/${id}/data-access/soft-filters`,
    { softFilterConcepts },
  );
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// ---------------------------------------------------------------------------------------
// Default query (landing saved search per group + project) — also gated on
// groups:manageDataAccess, same axis as the data-access endpoints above.
// ---------------------------------------------------------------------------------------

export interface SetGroupDefaultQueryInput {
  projectId: string;
  savedSearchId: string | null;
}

// Passing savedSearchId: null clears the default query for that project and the API
// responds with null (no GroupDefaultQuery to return) — see group.routes.ts's PUT
// .../default-query for the branch this mirrors.
export async function setGroupDefaultQuery(
  id: GroupId,
  input: SetGroupDefaultQueryInput,
): Promise<GroupDefaultQuery | null> {
  const response = await apiClient.put<ApiResponse<GroupDefaultQuery | null>>(
    `/groups/${id}/default-query`,
    input,
  );
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function clearGroupDefaultQuery(id: GroupId, projectId: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(
    `/groups/${id}/default-query/${projectId}`,
  );
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}
