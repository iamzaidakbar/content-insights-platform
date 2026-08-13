import type { ApiResponse, ArticleNote, CreateArticleNoteInput, UpdateArticleNoteInput } from '@content-insights/shared';

import { apiClient } from './api-client';

export async function fetchArticleNotes(articleId: string): Promise<ArticleNote[]> {
  const response = await apiClient.get<ApiResponse<ArticleNote[]>>(`/articles/${articleId}/notes`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function createArticleNote(articleId: string, input: CreateArticleNoteInput): Promise<ArticleNote> {
  const response = await apiClient.post<ApiResponse<ArticleNote>>(`/articles/${articleId}/notes`, input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function updateArticleNote(
  articleId: string,
  noteId: string,
  input: UpdateArticleNoteInput,
): Promise<ArticleNote> {
  const response = await apiClient.patch<ApiResponse<ArticleNote>>(`/articles/${articleId}/notes/${noteId}`, input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function deleteArticleNote(articleId: string, noteId: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<{ deleted: boolean }>>(`/articles/${articleId}/notes/${noteId}`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
}
