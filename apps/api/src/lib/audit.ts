import type { Request } from 'express';

import type { AuditAction, AuditEntityType } from '@content-insights/shared';

import { logger } from './logger.js';
import { AuditLogModel } from '../models/auditLog.model.js';

export interface AuditParams {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string;
  groupId?: string | null;
  /** Small structured summary of the change — never full payloads or secrets. */
  details?: Record<string, unknown>;
}

// Fire-and-forget: an audit write failing must never fail the audited operation.
// Call as `audit(req, {...})` — no await needed.
export function audit(req: Request, params: AuditParams): void {
  const user = req.user;
  if (!user) return; // unauthenticated actions use auditUnauthenticated below

  void AuditLogModel.create({
    orgId: user.orgId,
    actorId: user.id,
    actorEmail: user.email,
    action: params.action,
    entityType: params.entityType,
    ...(params.entityId !== undefined ? { entityId: params.entityId } : {}),
    ...(params.groupId !== undefined && params.groupId !== null ? { groupId: params.groupId } : {}),
    details: params.details ?? {},
    ...(req.ip !== undefined ? { ip: req.ip } : {}),
  }).catch((err: unknown) => {
    logger.error({ err, action: params.action }, 'Failed to write audit log entry');
  });
}

// For auth events where req.user isn't set yet (login/register) or identifies a
// different principal (failed login attempts) — actor info is passed explicitly.
export function auditAs(
  req: Request,
  actor: { orgId: string; userId: string; email: string },
  params: AuditParams,
): void {
  void AuditLogModel.create({
    orgId: actor.orgId,
    actorId: actor.userId,
    actorEmail: actor.email,
    action: params.action,
    entityType: params.entityType,
    ...(params.entityId !== undefined ? { entityId: params.entityId } : {}),
    ...(params.groupId !== undefined && params.groupId !== null ? { groupId: params.groupId } : {}),
    details: params.details ?? {},
    ...(req.ip !== undefined ? { ip: req.ip } : {}),
  }).catch((err: unknown) => {
    logger.error({ err, action: params.action }, 'Failed to write audit log entry');
  });
}
