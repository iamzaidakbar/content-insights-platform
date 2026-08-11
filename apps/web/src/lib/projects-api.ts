import type {
  ApiResponse,
  CreateProjectInput,
  PaginatedResult,
  Project,
  UpdateProjectInput,
} from '@content-insights/shared';

import { apiClient } from './api-client';

export async function fetchProjects(page = 1): Promise<PaginatedResult<Project>> {
  const response = await apiClient.get<ApiResponse<PaginatedResult<Project>>>('/projects', {
    params: { page },
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// Walks every page — the Data Access modal's Projects tab needs the org's complete project
// list to multi-select from, not one page's worth. Project counts are admin-configured and
// small in practice, same tradeoff fetchAllGroups (groups-api.ts) makes.
export async function fetchAllProjects(): Promise<Project[]> {
  const first = await fetchProjects(1);
  if (first.totalPages <= 1) {
    return first.items;
  }
  const rest = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, index) => fetchProjects(index + 2)),
  );
  return [...first.items, ...rest.flatMap((result) => result.items)];
}

export async function fetchProject(id: string): Promise<Project> {
  const response = await apiClient.get<ApiResponse<Project>>(`/projects/${id}`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const response = await apiClient.post<ApiResponse<Project>>('/projects', input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  const response = await apiClient.put<ApiResponse<Project>>(`/projects/${id}`, input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function deleteProject(id: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/projects/${id}`);
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}
