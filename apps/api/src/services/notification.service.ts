import type { NotificationType } from '@content-insights/shared';

import { logger } from '../lib/logger.js';
import { NotificationModel } from '../models/notification.model.js';

export interface CreateNotificationParams {
  orgId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: 'article' | 'group' | 'savedSearch';
  entityId?: string;
}

// Fire-and-forget by design: a failed notification write must never fail the operation
// that triggered it. Callers don't await error outcomes — errors are logged and dropped.
export async function notify(params: CreateNotificationParams): Promise<void> {
  try {
    await NotificationModel.create({
      orgId: params.orgId,
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body ?? '',
      ...(params.entityType !== undefined ? { entityType: params.entityType } : {}),
      ...(params.entityId !== undefined ? { entityId: params.entityId } : {}),
      read: false,
    });
  } catch (err) {
    logger.error({ err, type: params.type, userId: params.userId }, 'Failed to create notification');
  }
}

export async function notifyMany(
  userIds: string[],
  params: Omit<CreateNotificationParams, 'userId'>,
): Promise<void> {
  const unique = Array.from(new Set(userIds));
  await Promise.all(unique.map((userId) => notify({ ...params, userId })));
}
