import { z } from 'zod';

import { AUDIT_ACTIONS } from '../types/audit.js';

export const auditActionSchema = z.enum(AUDIT_ACTIONS);

export const auditEntityTypeSchema = z.enum([
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
]);

// GET /api/audit
export const listAuditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  action: auditActionSchema.optional(),
  entityType: auditEntityTypeSchema.optional(),
  entityId: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  // Matches AuditLogEntry.projectId — narrows the trail to activity recorded against one
  // project, alongside the existing action/entityType/entityId/actorId filters.
  projectId: z.string().min(1).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;
