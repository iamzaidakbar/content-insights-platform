export type Branded<T, B extends string> = T & { readonly __brand: B };

export type OrgId = Branded<string, 'OrgId'>;
export type UserId = Branded<string, 'UserId'>;
export type RoleId = Branded<string, 'RoleId'>;
export type GroupId = Branded<string, 'GroupId'>;
export type UserSettingsId = Branded<string, 'UserSettingsId'>;
export type SavedSearchId = Branded<string, 'SavedSearchId'>;
export type DashboardId = Branded<string, 'DashboardId'>;
export type AuditLogId = Branded<string, 'AuditLogId'>;
export type NotificationId = Branded<string, 'NotificationId'>;
export type ArticleId = Branded<string, 'ArticleId'>;
export type ProjectId = Branded<string, 'ProjectId'>;
export type ConceptId = Branded<string, 'ConceptId'>;
export type UserTagId = Branded<string, 'UserTagId'>;
export type InsightId = Branded<string, 'InsightId'>;
export type ChannelViewId = Branded<string, 'ChannelViewId'>;
export type GroupDefaultQueryId = Branded<string, 'GroupDefaultQueryId'>;
export type GlobalSettingsId = Branded<string, 'GlobalSettingsId'>;
export type EntityMappingId = Branded<string, 'EntityMappingId'>;
export type RoleAssignmentId = Branded<string, 'RoleAssignmentId'>;
export type TeamsShareId = Branded<string, 'TeamsShareId'>;
export type ArticleNoteId = Branded<string, 'ArticleNoteId'>;

// Narrowing helpers only — they do not validate. See src/validators for
// parsing untrusted input (e.g. request params) into these branded types.
export const asOrgId = (value: string): OrgId => value as OrgId;
export const asUserId = (value: string): UserId => value as UserId;
export const asRoleId = (value: string): RoleId => value as RoleId;
export const asGroupId = (value: string): GroupId => value as GroupId;
export const asUserSettingsId = (value: string): UserSettingsId => value as UserSettingsId;
export const asSavedSearchId = (value: string): SavedSearchId => value as SavedSearchId;
export const asDashboardId = (value: string): DashboardId => value as DashboardId;
export const asAuditLogId = (value: string): AuditLogId => value as AuditLogId;
export const asNotificationId = (value: string): NotificationId => value as NotificationId;
export const asArticleId = (value: string): ArticleId => value as ArticleId;
export const asProjectId = (value: string): ProjectId => value as ProjectId;
export const asConceptId = (value: string): ConceptId => value as ConceptId;
export const asUserTagId = (value: string): UserTagId => value as UserTagId;
export const asInsightId = (value: string): InsightId => value as InsightId;
export const asChannelViewId = (value: string): ChannelViewId => value as ChannelViewId;
export const asGroupDefaultQueryId = (value: string): GroupDefaultQueryId =>
  value as GroupDefaultQueryId;
export const asGlobalSettingsId = (value: string): GlobalSettingsId => value as GlobalSettingsId;
export const asEntityMappingId = (value: string): EntityMappingId => value as EntityMappingId;
export const asRoleAssignmentId = (value: string): RoleAssignmentId => value as RoleAssignmentId;
export const asTeamsShareId = (value: string): TeamsShareId => value as TeamsShareId;
export const asArticleNoteId = (value: string): ArticleNoteId => value as ArticleNoteId;
