import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { AUDIT_ACTIONS, type AuditAction, type AuditEntityType } from '@content-insights/shared';

export interface IAuditLog {
  orgId: mongoose.Types.ObjectId;
  actorId: mongoose.Types.ObjectId;
  actorEmail: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string;
  groupId?: mongoose.Types.ObjectId | null;
  projectId?: mongoose.Types.ObjectId | null;
  details: Record<string, unknown>;
  ip?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type AuditLogDocument = HydratedDocument<IAuditLog>;

const auditLogSchema = new mongoose.Schema<IAuditLog>(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Denormalized at write time — the audit trail must stay accurate even if the
    // user is later deleted or changes email.
    actorEmail: { type: String, required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    entityType: {
      type: String,
      enum: [
        'article',
        'project',
        'concept',
        'group',
        'role',
        'user',
        'organization',
        'saved-search',
        'user-tag',
        'insight',
        'dashboard',
        'entity-mapping',
        'search',
        'article-note',
      ],
      required: true,
    },
    entityId: { type: String, required: false },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: false, default: null },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: false,
      default: null,
    },
    details: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    ip: { type: String, required: false },
  },
  { timestamps: true },
);
auditLogSchema.index({ orgId: 1, createdAt: -1 });
auditLogSchema.index({ orgId: 1, action: 1, createdAt: -1 });
auditLogSchema.index({ orgId: 1, actorId: 1, createdAt: -1 });
auditLogSchema.index({ orgId: 1, entityType: 1, entityId: 1 });
auditLogSchema.index({ orgId: 1, projectId: 1, createdAt: -1 });

export const AuditLogModel =
  (mongoose.models.AuditLog as Model<IAuditLog> | undefined) ??
  mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
