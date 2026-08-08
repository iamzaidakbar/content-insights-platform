import type {
  ApiResponse,
  DateRangeFilter,
  DocumentFileType,
  SearchResponse,
} from '@content-insights/shared';

import { apiClient } from './api-client';

export interface SearchDocumentsParams {
  query: string;
  projectIds: string[];
  fileTypes: DocumentFileType[];
  dateRange?: DateRangeFilter | undefined;
  page: number;
  size: number;
}

export async function searchDocuments(params: SearchDocumentsParams): Promise<SearchResponse> {
  const response = await apiClient.post<ApiResponse<SearchResponse>>('/search', params);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
