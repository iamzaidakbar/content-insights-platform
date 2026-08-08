import type { ApiResponse, DateRangeFilter, Document, PaginatedResult } from '@content-insights/shared';

import { apiClient } from './api-client';

export interface FetchDocumentsParams {
  page: number;
  pageSize: number;
  projectIds?: string[] | undefined;
  dateRange?: DateRangeFilter | undefined;
}

export async function fetchDocuments(params: FetchDocumentsParams): Promise<PaginatedResult<Document>> {
  const { page, pageSize, projectIds, dateRange } = params;
  const response = await apiClient.get<ApiResponse<PaginatedResult<Document>>>('/documents', {
    params: {
      page,
      pageSize,
      ...(projectIds && projectIds.length > 0 ? { projectIds: projectIds.join(',') } : {}),
      ...(dateRange?.start ? { from: dateRange.start } : {}),
      ...(dateRange?.end ? { to: dateRange.end } : {}),
    },
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
