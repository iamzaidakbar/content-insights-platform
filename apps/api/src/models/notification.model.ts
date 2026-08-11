import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { NOTIFICATION_TYPES, type NotificationType } from '@content-insights/shared';

export interface INotification {
  orgId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: 'article' | 'group' | 'savedSearch';
  entityId?: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationDocument = HydratedDocument<INotification>;

const notificationSchema = new mongoose.Schema<INotification>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true, default: '' },
    entityType: {
      type: String,
      enum: ['article', 'group', 'savedSearch'],
      required: false,
    },
    entityId: { type: String, required: false },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1 });

export const NotificationModel =
  (mongoose.models.Notification as Model<INotification> | undefined) ??
  mongoose.model<INotification>('Notification', notificationSchema);
