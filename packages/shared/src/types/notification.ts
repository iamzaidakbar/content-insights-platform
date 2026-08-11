import type { NotificationId, OrgId, UserId } from '../ids.js';

export const NOTIFICATION_TYPES = [
  'article.ingested',
  'channel.new_results',
  'permission.changed',
  'saved-search.shared',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: NotificationId;
  orgId: OrgId;
  userId: UserId;
  type: NotificationType;
  title: string;
  body: string;
  /** Deep-link target, e.g. 'article' + id → /articles/:id. */
  entityType?: 'article' | 'group' | 'savedSearch';
  entityId?: string;
  read: boolean;
  createdAt: string;
}

export interface UnreadCount {
  unread: number;
}
