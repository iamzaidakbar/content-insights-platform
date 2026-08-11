import express from 'express';

import {
  listNotificationsQuerySchema,
  type ListNotificationsQuery,
  type Notification,
  type PaginatedResult,
  type UnreadCount,
} from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError, NotFoundError } from '../lib/errors.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { success } from '../lib/response.js';
import { toNotificationDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { validate } from '../middleware/validate.js';
import { NotificationModel } from '../models/notification.model.js';

export const notificationRouter = express.Router();

// Notifications are strictly personal — every query is keyed by the caller's own
// userId, so no extra permission gate is needed beyond authentication.

notificationRouter.get(
  '/',
  authenticate,
  orgContext,
  validate({ query: listNotificationsQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const query = req.query as unknown as ListNotificationsQuery;
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const filter: Record<string, unknown> = { userId: req.user.id, orgId: req.user.orgId };
    if (query.unreadOnly) filter.read = false;

    const [items, total] = await Promise.all([
      NotificationModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      NotificationModel.countDocuments(filter),
    ]);

    const result: PaginatedResult<Notification> = {
      items: items.map(toNotificationDTO),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
    res.status(200).json(success(result));
  }),
);

notificationRouter.get(
  '/unread-count',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const unread = await NotificationModel.countDocuments({
      userId: req.user.id,
      orgId: req.user.orgId,
      read: false,
    });
    res.status(200).json(success({ unread } satisfies UnreadCount));
  }),
);

notificationRouter.patch(
  '/:id/read',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Notification not found', 'NOTIFICATION_NOT_FOUND');
    const notification = await NotificationModel.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { $set: { read: true } },
      { new: true },
    );
    if (!notification) {
      throw new NotFoundError('Notification not found', 'NOTIFICATION_NOT_FOUND');
    }
    res.status(200).json(success(toNotificationDTO(notification)));
  }),
);

notificationRouter.post(
  '/read-all',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    await NotificationModel.updateMany(
      { userId: req.user.id, orgId: req.user.orgId, read: false },
      { $set: { read: true } },
    );
    res.status(200).json(success({ updated: true }));
  }),
);
