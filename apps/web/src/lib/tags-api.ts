import type { ApiResponse, Tag } from '@content-insights/shared';

import { apiClient } from './api-client';

export async function fetchTags(): Promise<Tag[]> {
  const response = await apiClient.get<ApiResponse<Tag[]>>('/tags');
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export interface CreateTagInput {
  name: string;
  color: string;
}
export async function createTag(input: CreateTagInput): Promise<Tag> {
  const response = await apiClient.post<ApiResponse<Tag>>('/tags', input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
