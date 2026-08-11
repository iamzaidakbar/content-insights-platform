import type {
  ApiResponse,
  AuditAction,
  AuditEntityType,
  AuditLogEntry,
  PaginatedResult,
} from '@content-insights/shared';

import { apiClient } from './api-client';

export interface FetchAuditLogParams {
  page?: number;
  pageSize?: number;
  action?: AuditAction | undefined;
  entityType?: AuditEntityType | undefined;
  entityId?: string | undefined;
  actorId?: string | undefined;
  // Narrows the trail to activity recorded against one project — matches
  // AuditLogEntry.projectId / listAuditLogQuerySchema's projectId filter.
  projectId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export async function fetchAuditLog(
  params: FetchAuditLogParams = {},
): Promise<PaginatedResult<AuditLogEntry>> {
  const response = await apiClient.get<ApiResponse<PaginatedResult<AuditLogEntry>>>('/audit', {
    params: Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
    ),
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
