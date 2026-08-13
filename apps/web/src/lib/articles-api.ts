import type {
  ApiResponse,
  Article,
  ArticleAssetKind,
  ArticleBulkRequestInput,
  BulkOperationResult,
  FilterPanelState,
} from '@content-insights/shared';

import { apiClient } from './api-client';

// Note: there is no plain "list articles" endpoint — GET /api/articles/:id and the
// upload/patch/hide/bulk/export actions below are the whole surface of the Articles
// router. Browsing/listing articles always goes through POST /api/search (see
// search-api.ts's searchArticles), even for an empty query / filters-only browse.

export async function fetchArticle(id: string): Promise<Article> {
  const response = await apiClient.get<ApiResponse<Article>>(`/articles/${id}`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// POST /api/articles/upload — File System source type only; news-sourced articles arrive
// solely via the ingest worker, never through this endpoint. No canonical validator for
// this body exists in article.schema.ts (it's endpoint-specific, not part of the Article
// entity), so this local shape mirrors uploadArticleBodySchema in article.routes.ts exactly.
export interface UploadArticleInput {
  file: File;
  title: string;
  projectId: string;
  domain?: string;
  summary?: string;
  url?: string;
  publishedAt?: string;
  authors?: string[];
}

export async function uploadArticle(input: UploadArticleInput): Promise<Article> {
  const formData = new FormData();
  formData.append('file', input.file);
  formData.append('title', input.title);
  formData.append('projectId', input.projectId);
  if (input.domain) formData.append('domain', input.domain);
  if (input.summary !== undefined) formData.append('summary', input.summary);
  if (input.url) formData.append('url', input.url);
  if (input.publishedAt) formData.append('publishedAt', input.publishedAt);
  // Multipart text fields are always strings — comma-separated, matching the server's
  // uploadArticleBodySchema decoding of `authors`.
  if (input.authors && input.authors.length > 0) {
    formData.append('authors', input.authors.join(','));
  }

  const response = await apiClient.post<ApiResponse<Article>>('/articles/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// Authenticated binary download: fetch as a blob through the axios client (which carries
// the bearer token), then hand the bytes to the browser via a temporary object URL.
export async function downloadArticle(
  id: string,
  filename: string,
  kind?: ArticleAssetKind,
): Promise<void> {
  const response = await apiClient.get<Blob>(`/articles/${id}/download`, {
    params: { ...(kind ? { kind } : {}) },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Blob URL for inline preview (PDF iframe, <img>). Caller must revoke it when done. */
export async function fetchArticlePreviewUrl(id: string, kind?: ArticleAssetKind): Promise<string> {
  const response = await apiClient.get<Blob>(`/articles/${id}/preview`, {
    params: { ...(kind ? { kind } : {}) },
    responseType: 'blob',
  });
  return URL.createObjectURL(response.data);
}

// PATCH /api/articles/:id — metadata edit. Same "endpoint-specific, not in article.schema.ts"
// reasoning as UploadArticleInput above; mirrors updateArticleMetadataSchema exactly.
export interface UpdateArticleInput {
  title?: string;
  summary?: string;
  domain?: string;
  url?: string;
  authors?: string[];
  publishedAt?: string;
}

export async function updateArticle(id: string, input: UpdateArticleInput): Promise<Article> {
  const response = await apiClient.patch<ApiResponse<Article>>(`/articles/${id}`, input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function hideArticle(id: string): Promise<Article> {
  const response = await apiClient.post<ApiResponse<Article>>(`/articles/${id}/hide`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function unhideArticle(id: string): Promise<Article> {
  const response = await apiClient.post<ApiResponse<Article>>(`/articles/${id}/unhide`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// POST /api/articles/bulk — reuses the shared validator's inferred type directly since it
// exactly matches the request body (action + articleIds + optional tagIds for
// addTags/removeTags).
export async function bulkArticleOperation(input: ArticleBulkRequestInput): Promise<BulkOperationResult> {
  const response = await apiClient.post<ApiResponse<BulkOperationResult>>('/articles/bulk', input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// POST /api/articles/export — current filtered result set (up to 1000 rows) as an .xlsx
// workbook. Raw binary response, not an ApiResponse envelope.
export async function exportArticles(
  filters: FilterPanelState,
  format: 'xlsx' | 'csv' = 'xlsx',
): Promise<void> {
  const response = await apiClient.post<Blob>(
    '/articles/export',
    { filters, format },
    { responseType: 'blob' },
  );
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = format === 'csv' ? 'articles-export.csv' : 'articles-export.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
