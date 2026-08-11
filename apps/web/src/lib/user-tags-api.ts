import type {
  ApiResponse,
  BulkOperationResult,
  CreateUserTagInput,
  ShareUserTagInput,
  UpdateUserTagInput,
  UserTag,
} from '@content-insights/shared';

import { apiClient } from './api-client';

function unwrap<T>(body: ApiResponse<T>): T {
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// GET / — every public tag in the org plus private tags the caller's groups can see (empty
// array, not a 403, for a caller with no user-tags:read scope anywhere — see userTag.routes.ts).
export async function fetchUserTags(): Promise<UserTag[]> {
  const response = await apiClient.get<ApiResponse<UserTag[]>>('/user-tags');
  return unwrap(response.data);
}

// POST / — ownerGroupId is never sent; the API derives it from the caller's currentGroupId.
export async function createUserTag(input: CreateUserTagInput): Promise<UserTag> {
  const response = await apiClient.post<ApiResponse<UserTag>>('/user-tags', input);
  return unwrap(response.data);
}

// PUT /:id (route is PUT despite the validator's own PATCH-flavored comment — see
// userTag.routes.ts). Only send the fields being changed; updateUserTagSchema requires at
// least one.
export async function updateUserTag(id: string, input: UpdateUserTagInput): Promise<UserTag> {
  const response = await apiClient.put<ApiResponse<UserTag>>(`/user-tags/${id}`, input);
  return unwrap(response.data);
}

// DELETE /:id — owner group (or org admin) only; also strips the tag from every article that
// carries it, server-side.
export async function deleteUserTag(id: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/user-tags/${id}`);
  unwrap(response.data);
}

export async function publishUserTag(id: string): Promise<UserTag> {
  const response = await apiClient.post<ApiResponse<UserTag>>(`/user-tags/${id}/publish`);
  return unwrap(response.data);
}

// POST /:id/share — upserts one or more per-group grants at once. canUse/canDelete only ever
// gate bulk-apply/bulk-remove on articles; they never grant rights over the tag entity itself.
export async function shareUserTag(id: string, input: ShareUserTagInput): Promise<UserTag> {
  const response = await apiClient.post<ApiResponse<UserTag>>(`/user-tags/${id}/share`, input);
  return unwrap(response.data);
}

// DELETE /:id/share/:groupId — revoke a previously granted share.
export async function revokeUserTagShare(id: string, groupId: string): Promise<UserTag> {
  const response = await apiClient.delete<ApiResponse<UserTag>>(`/user-tags/${id}/share/${groupId}`);
  return unwrap(response.data);
}

// Body shape for POST /bulk-apply and /bulk-remove — validated server-side by a local schema
// (bulkTagArticlesSchema in userTag.routes.ts), not part of the canonical shared package.
export interface BulkTagArticlesInput {
  articleIds: string[];
  tagId: string;
}

// POST /bulk-apply — attach one tag to many articles. Requires CanUse on the tag (owner group
// membership, an explicit share grant, or org-wide user-tags:manage for a public tag).
export async function bulkApplyUserTag(input: BulkTagArticlesInput): Promise<BulkOperationResult> {
  const response = await apiClient.post<ApiResponse<BulkOperationResult>>('/user-tags/bulk-apply', input);
  return unwrap(response.data);
}

// POST /bulk-remove — detach one tag from many articles. Requires CanDelete on the tag.
export async function bulkRemoveUserTag(input: BulkTagArticlesInput): Promise<BulkOperationResult> {
  const response = await apiClient.post<ApiResponse<BulkOperationResult>>('/user-tags/bulk-remove', input);
  return unwrap(response.data);
}
