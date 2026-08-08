import type { ApiResponse, Document, PaginatedResult } from '@content-insights/shared';

import { apiClient } from './api-client';

export async function fetchDocuments(page: number): Promise<PaginatedResult<Document>> {
  const response = await apiClient.get<ApiResponse<PaginatedResult<Document>>>('/documents', {
    params: { page },
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function fetchDocument(id: string): Promise<Document> {
  const response = await apiClient.get<ApiResponse<Document>>(`/documents/${id}`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function fetchProjectIds(): Promise<string[]> {
  const response = await apiClient.get<ApiResponse<string[]>>('/documents/projects');
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
