import type {
  ApiResponse,
  Notification,
  PaginatedResult,
  UnreadCount,
} from '@content-insights/shared';

import { apiClient } from './api-client';

function unwrap<T>(body: ApiResponse<T>): T {
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function fetchNotifications(
  page = 1,
  pageSize = 20,
  unreadOnly = false,
): Promise<PaginatedResult<Notification>> {
  const response = await apiClient.get<ApiResponse<PaginatedResult<Notification>>>(
    '/notifications',
    { params: { page, pageSize, ...(unreadOnly ? { unreadOnly: 'true' } : {}) } },
  );
  return unwrap(response.data);
}

export async function fetchUnreadCount(): Promise<UnreadCount> {
  const response = await apiClient.get<ApiResponse<UnreadCount>>('/notifications/unread-count');
  return unwrap(response.data);
}

export async function markNotificationRead(id: string): Promise<Notification> {
  const response = await apiClient.patch<ApiResponse<Notification>>(`/notifications/${id}/read`);
  return unwrap(response.data);
}

export async function markAllNotificationsRead(): Promise<void> {
  const response = await apiClient.post<ApiResponse<{ updated: boolean }>>('/notifications/read-all');
  unwrap(response.data);
}
