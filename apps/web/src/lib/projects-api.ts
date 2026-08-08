import type { ApiResponse, PaginatedResult, Project, ProjectId } from '@content-insights/shared';

import { apiClient } from './api-client';

export async function fetchProjects(): Promise<PaginatedResult<Project>> {
  const response = await apiClient.get<ApiResponse<PaginatedResult<Project>>>('/projects');
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function fetchProject(id: ProjectId): Promise<Project> {
  const response = await apiClient.get<ApiResponse<Project>>(`/projects/${id}`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const response = await apiClient.post<ApiResponse<Project>>('/projects', input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
}

export async function updateProject(id: ProjectId, input: UpdateProjectInput): Promise<Project> {
  const response = await apiClient.put<ApiResponse<Project>>(`/projects/${id}`, input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function deleteProject(id: ProjectId): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/projects/${id}`);
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}

export interface AddProjectMemberInput {
  userId: string;
  roleId: string;
}

export async function addProjectMember(
  projectId: ProjectId,
  input: AddProjectMemberInput,
): Promise<Project> {
  const response = await apiClient.post<ApiResponse<Project>>(
    `/projects/${projectId}/members`,
    input,
  );
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function removeProjectMember(projectId: ProjectId, userId: string): Promise<Project> {
  const response = await apiClient.delete<ApiResponse<Project>>(
    `/projects/${projectId}/members/${userId}`,
  );
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
