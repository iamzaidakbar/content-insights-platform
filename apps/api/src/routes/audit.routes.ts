import express from 'express';
import mongoose from 'mongoose';

import {
  listAuditLogQuerySchema,
  type AuditLogEntry,
  type ListAuditLogQuery,
  type PaginatedResult,
} from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ForbiddenError } from '../lib/errors.js';
import { success } from '../lib/response.js';
import { toAuditLogDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { validate } from '../middleware/validate.js';
import { AuditLogModel } from '../models/auditLog.model.js';

export const auditRouter = express.Router();

// Readable by org admins or holders of the dedicated audit:read permission —
// requirePermission takes exactly one key, so this either-of check is inline.
// Checked against the JWT-denormalized global permission set (req.user.globalPermissions),
// same as every other plain (non-group-scoped) permission gate in this codebase.
function assertCanReadAudit(globalPermissions: string[]): void {
  if (
    !globalPermissions.includes('*') &&
    !globalPermissions.includes('org:admin') &&
    !globalPermissions.includes('audit:read')
  ) {
    throw new ForbiddenError('Missing required permission: audit:read');
  }
}

auditRouter.get(
  '/',
  authenticate,
  orgContext,
  validate({ query: listAuditLogQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    assertCanReadAudit(req.user.globalPermissions);

    const query = req.query as unknown as ListAuditLogQuery;
    const page = query.page || 1;
    const pageSize = query.pageSize || 25;

    const filter: Record<string, unknown> = { orgId: req.user.orgId };
    if (query.action) filter.action = query.action;
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.actorId && mongoose.isValidObjectId(query.actorId)) filter.actorId = query.actorId;
    if (query.projectId && mongoose.isValidObjectId(query.projectId)) filter.projectId = query.projectId;
    if (query.from ?? query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }

    const [items, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      AuditLogModel.countDocuments(filter),
    ]);

    const result: PaginatedResult<AuditLogEntry> = {
      items: items.map(toAuditLogDTO),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
    res.status(200).json(success(result));
  }),
);

const AUDIT_EXPORT_MAX = 5000;

auditRouter.get(
  '/export',
  authenticate,
  orgContext,
  validate({ query: listAuditLogQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    assertCanReadAudit(req.user.globalPermissions);

    const query = req.query as unknown as ListAuditLogQuery;
    const filter: Record<string, unknown> = { orgId: req.user.orgId };
    if (query.action) filter.action = query.action;
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.actorId && mongoose.isValidObjectId(query.actorId)) filter.actorId = query.actorId;
    if (query.projectId && mongoose.isValidObjectId(query.projectId)) filter.projectId = query.projectId;
    if (query.from ?? query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }

    const items = await AuditLogModel.find(filter).sort({ createdAt: -1 }).limit(AUDIT_EXPORT_MAX);
    const header = ['createdAt', 'actorEmail', 'action', 'entityType', 'entityId', 'details'];
    const rows = items.map((entry) => {
      const dto = toAuditLogDTO(entry);
      return [
        dto.createdAt,
        dto.actorEmail,
        dto.action,
        dto.entityType,
        dto.entityId ?? '',
        JSON.stringify(dto.details).replace(/"/g, '""'),
      ]
        .map((value) => `"${value}"`)
        .join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-export.csv"');
    res.status(200).send(csv);
  }),
);
