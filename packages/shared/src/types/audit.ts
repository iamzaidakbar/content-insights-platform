import type { AuditLogId, GroupId, OrgId, UserId } from '../ids.js';

export const AUDIT_ACTIONS = [
  'auth.register',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_change',
  'auth.sso_login',
  'article.hide',
  'article.unhide',
  'article.tag',
  'article.untag',
  'article.bulk_operation',
  'project.create',
  'project.update',
  'project.delete',
  'concept.create',
  'concept.update',
  'concept.delete',
  'saved-search.create',
  'saved-search.update',
  'saved-search.delete',
  'saved-search.share',
  'saved-search.set_default',
  'channel.expose',
  'channel.demote',
  'user-tag.create',
  'user-tag.update',
  'user-tag.delete',
  'user-tag.publish',
  'user-tag.share',
  'insight.create',
  'insight.update',
  'insight.delete',
  'dashboard.create',
  'dashboard.update',
  'dashboard.delete',
  'entity-mapping.sync',
  'ms-teams.share',
  'global-settings.update',
  'search.query',
  'group.create',
  'group.update',
  'group.delete',
  'group.member_add',
  'group.member_remove',
  'role.create',
  'role.update',
  'role.delete',
  'role.assign',
  'role.revoke',
  'org.update',
  'user.create',
  'user.delete',
  'user.deactivate',
  'admin.reindex',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntityType =
  | 'article'
  | 'project'
  | 'concept'
  | 'group'
  | 'role'
  | 'user'
  | 'organization'
  | 'saved-search'
  | 'user-tag'
  | 'insight'
  | 'dashboard'
  | 'entity-mapping'
  | 'search';

export interface AuditLogEntry {
  id: AuditLogId;
  orgId: OrgId;
  actorId: UserId;
  actorEmail: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string;
  groupId?: GroupId;
  projectId?: string;
  /** Small structured summary of the change (never full payloads/secrets). */
  details: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}
