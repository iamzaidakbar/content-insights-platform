import type {
  AuditLogEntry,
  Dashboard,
  DashboardInsightRef,
  DashboardLayoutItem,
  EntityMapping,
  EntityMappingEntry,
  FilterLayout,
  FilterLayoutItem,
  FilterPanelState,
  GlobalSettings,
  Group,
  GroupDataAccess,
  GroupDefaultQuery,
  GroupMemberSummary,
  HardFilterGrant,
  Insight,
  InsightConfig,
  Notification,
  Organization,
  OrganizationDetail,
  Role,
  RoleAssignment,
  SoftFilterConceptGrant,
  TeamsShareRecord,
  User,
  UserSettings,
} from '@content-insights/shared';
import {
  asAuditLogId,
  asConceptId,
  asDashboardId,
  asEntityMappingId,
  asGlobalSettingsId,
  asGroupDefaultQueryId,
  asGroupId,
  asInsightId,
  asNotificationId,
  asOrgId,
  asProjectId,
  asRoleAssignmentId,
  asRoleId,
  asSavedSearchId,
  asTeamsShareId,
  asUserId,
  asUserSettingsId,
} from '@content-insights/shared';

import type { AuditLogDocument } from '../models/auditLog.model.js';
import type { DashboardDocument } from '../models/dashboard.model.js';
import type { EntityMappingDocument, IEntityMappingEntry } from '../models/entityMapping.model.js';
import type { FilterLayoutDocument, IFilterLayoutItem } from '../models/filterLayout.model.js';
import type { GlobalSettingsDocument } from '../models/globalSettings.model.js';
import type { GroupDocument, IGroupDataAccess } from '../models/group.model.js';
import type { GroupDefaultQueryDocument } from '../models/groupDefaultQuery.model.js';
import type { InsightDocument } from '../models/insight.model.js';
import type { NotificationDocument } from '../models/notification.model.js';
import type { OrganizationDocument } from '../models/organization.model.js';
import type { RoleDocument } from '../models/role.model.js';
import type { TeamsShareDocument } from '../models/teamsShare.model.js';
import type { UserDocument } from '../models/user.model.js';
import type { UserSettingsDocument } from '../models/userSettings.model.js';

export function toOrganizationDTO(org: OrganizationDocument): Organization {
  return {
    id: asOrgId(org._id.toString()),
    name: org.name,
    slug: org.slug,
    plan: org.plan,
    ...(org.ssoDomain ? { ssoDomain: org.ssoDomain } : {}),
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}

// roleName/groupName are denormalized onto each RoleAssignment for display (see that
// type's own comment in @content-insights/shared) but the User document itself only ever
// stores roleId/groupId — every route that builds a User DTO must first batch-resolve the
// Role/Group names referenced across the roleAssignments it's about to serialize (see
// lib/role-assignment-lookup.ts's loadRoleAssignmentLookup) and pass the result in here.
export interface RoleAssignmentLookup {
  roleNamesById: Map<string, string>;
  groupNamesById: Map<string, string>;
}

export function buildRoleAssignmentLookup(
  roles: Pick<RoleDocument, '_id' | 'name'>[],
  groups: Pick<GroupDocument, '_id' | 'name'>[],
): RoleAssignmentLookup {
  return {
    roleNamesById: new Map(roles.map((role) => [role._id.toString(), role.name])),
    groupNamesById: new Map(groups.map((group) => [group._id.toString(), group.name])),
  };
}

export function toUserDTO(user: UserDocument, lookup: RoleAssignmentLookup): User {
  const roleAssignments: RoleAssignment[] = [];
  for (const assignment of user.roleAssignments) {
    const roleName = lookup.roleNamesById.get(assignment.roleId.toString());
    // Dangling role reference (the referenced Role no longer exists) grants nothing (see
    // resolveEffectivePermissions) — drop it from the DTO rather than surface a name-less
    // entry. Shouldn't happen in practice: role.routes.ts blocks deleting an in-use role.
    if (!roleName) continue;
    const groupName = assignment.groupId
      ? lookup.groupNamesById.get(assignment.groupId.toString())
      : undefined;
    roleAssignments.push({
      id: asRoleAssignmentId(assignment._id.toString()),
      roleId: asRoleId(assignment.roleId.toString()),
      roleName,
      groupId: assignment.groupId ? asGroupId(assignment.groupId.toString()) : null,
      ...(groupName !== undefined ? { groupName } : {}),
      startDate: assignment.startDate ? assignment.startDate.toISOString() : null,
      endDate: assignment.endDate ? assignment.endDate.toISOString() : null,
    });
  }

  return {
    id: asUserId(user._id.toString()),
    orgId: asOrgId(user.orgId.toString()),
    email: user.email,
    // exactOptionalPropertyTypes: omit the key entirely when absent, never assign undefined.
    ...(user.displayName !== undefined ? { displayName: user.displayName } : {}),
    isActive: user.isActive,
    provisioning: user.provisioning ?? 'local',
    ...(user.lastLoginAt ? { lastLoginAt: user.lastLoginAt.toISOString() } : {}),
    roleAssignments,
    currentGroupId: user.currentGroupId ? asGroupId(user.currentGroupId.toString()) : null,
    currentProjectId: user.currentProjectId ? asProjectId(user.currentProjectId.toString()) : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toRoleDTO(role: RoleDocument): Role {
  return {
    id: asRoleId(role._id.toString()),
    orgId: asOrgId(role.orgId.toString()),
    name: role.name,
    permissions: role.permissions,
    isSystem: role.isSystem,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

// Group's roster is a read-model resolved server-side from User.roleAssignments (see
// Group.members's own comment in @content-insights/shared) — this just shapes one already-
// resolved {user, role, assignment} triple, it never queries anything itself.
export function toGroupMemberSummaryDTO(
  user: Pick<UserDocument, '_id' | 'email'>,
  role: Pick<RoleDocument, '_id' | 'name'>,
  startDate: Date | null,
  endDate: Date | null,
): GroupMemberSummary {
  return {
    userId: asUserId(user._id.toString()),
    userEmail: user.email,
    roleId: asRoleId(role._id.toString()),
    roleName: role.name,
    startDate: startDate ? startDate.toISOString() : null,
    endDate: endDate ? endDate.toISOString() : null,
  };
}

// Only the non-`dataAccess` scalar fields are read here — `dataAccess` is mapped separately
// below (it needs conceptNamesById to denormalize conceptName) and `members` is passed in
// already resolved. Narrowing the param to just these fields (rather than the full
// `GroupDocument`) sidesteps a Mongoose `.populate<T>()` typing quirk: a populated doc's
// field types no longer structurally match the unpopulated `IGroup` shape, so a populated
// result isn't assignable to `GroupDocument` even though every field this function actually
// touches is still present.
type GroupDTOSource = Pick<
  GroupDocument,
  '_id' | 'orgId' | 'name' | 'description' | 'dataAccess' | 'createdAt' | 'updatedAt'
>;

function toGroupDataAccessDTO(
  dataAccess: IGroupDataAccess,
  conceptNamesById: Map<string, string>,
): GroupDataAccess {
  const hardFilterGrants: HardFilterGrant[] = [];
  for (const grant of dataAccess.hardFilterGrants) {
    const conceptName = conceptNamesById.get(grant.conceptId.toString());
    // Dangling concept reference — drop rather than surface a name-less grant. Shouldn't
    // happen: nothing in this codebase deletes a Concept that's still referenced here.
    if (!conceptName) continue;
    hardFilterGrants.push({
      conceptId: asConceptId(grant.conceptId.toString()),
      conceptName,
      allowedValues: grant.allowedValues,
      ...(grant.denialNote !== undefined ? { denialNote: grant.denialNote } : {}),
    });
  }

  const softFilterConcepts: SoftFilterConceptGrant[] = [];
  for (const grant of dataAccess.softFilterConcepts) {
    const conceptName = conceptNamesById.get(grant.conceptId.toString());
    if (!conceptName) continue;
    softFilterConcepts.push({
      conceptId: asConceptId(grant.conceptId.toString()),
      conceptName,
      order: grant.order,
    });
  }

  return {
    projectIds: dataAccess.projectIds.map((id) => asProjectId(id.toString())),
    hardFilterGrants,
    softFilterConcepts,
  };
}

export function toGroupDTO(
  group: GroupDTOSource,
  members: GroupMemberSummary[],
  conceptNamesById: Map<string, string>,
): Group {
  return {
    id: asGroupId(group._id.toString()),
    orgId: asOrgId(group.orgId.toString()),
    name: group.name,
    description: group.description,
    dataAccess: toGroupDataAccessDTO(group.dataAccess, conceptNamesById),
    members,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export function toGroupDefaultQueryDTO(
  doc: Pick<
    GroupDefaultQueryDocument,
    '_id' | 'orgId' | 'groupId' | 'projectId' | 'savedSearchId' | 'createdAt' | 'updatedAt'
  >,
  savedSearchName: string,
): GroupDefaultQuery {
  return {
    id: asGroupDefaultQueryId(doc._id.toString()),
    orgId: asOrgId(doc.orgId.toString()),
    groupId: asGroupId(doc.groupId.toString()),
    projectId: asProjectId(doc.projectId.toString()),
    savedSearchId: asSavedSearchId(doc.savedSearchId.toString()),
    savedSearchName,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toOrganizationDetailDTO(org: OrganizationDocument, memberCount: number): OrganizationDetail {
  return { ...toOrganizationDTO(org), memberCount };
}

export function toUserSettingsDTO(settings: UserSettingsDocument): UserSettings {
  return {
    id: asUserSettingsId(settings._id.toString()),
    userId: asUserId(settings.userId.toString()),
    orgId: asOrgId(settings.orgId.toString()),
    theme: settings.theme,
    dateFormat: settings.dateFormat,
    facetSortOrder: settings.facetSortOrder,
    hideZeroCountFacets: settings.hideZeroCountFacets,
    cardContentLines: settings.cardContentLines,
    languagePreference: settings.languagePreference,
    defaultResultView: settings.defaultResultView,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

// ownerId/createdBy may each be populated ({_id, email}) or raw ObjectIds — used by
// toInsightDTO below (route handlers populate `ownerId`, selecting just `email`, before
// calling it).
interface PopulatedOwner {
  _id: { toString(): string };
  email: string;
}

export function toAuditLogDTO(entry: AuditLogDocument): AuditLogEntry {
  return {
    id: asAuditLogId(entry._id.toString()),
    orgId: asOrgId(entry.orgId.toString()),
    actorId: asUserId(entry.actorId.toString()),
    actorEmail: entry.actorEmail,
    action: entry.action,
    entityType: entry.entityType,
    ...(entry.entityId != null ? { entityId: entry.entityId } : {}),
    ...(entry.groupId != null ? { groupId: asGroupId(entry.groupId.toString()) } : {}),
    ...(entry.projectId != null ? { projectId: entry.projectId.toString() } : {}),
    details: entry.details ?? {},
    ...(entry.ip != null ? { ip: entry.ip } : {}),
    createdAt: entry.createdAt.toISOString(),
  };
}

export function toNotificationDTO(notification: NotificationDocument): Notification {
  return {
    id: asNotificationId(notification._id.toString()),
    orgId: asOrgId(notification.orgId.toString()),
    userId: asUserId(notification.userId.toString()),
    type: notification.type,
    title: notification.title,
    body: notification.body,
    ...(notification.entityType != null ? { entityType: notification.entityType } : {}),
    ...(notification.entityId != null ? { entityId: notification.entityId } : {}),
    read: notification.read,
    createdAt: notification.createdAt.toISOString(),
  };
}

// `ownerId` is typed as an already-populated {_id, email} pair (not the raw ObjectId
// IInsight.ownerId declares) — same populate-typing-quirk workaround as GroupDTOSource
// above: route handlers populate `ownerId` (selecting just `email`) before calling this.
//
// Note: SavedSearch has no equivalent DTO helper here — lib/savedSearch.service.ts owns
// toSavedSearchDTO/toSavedSearchDTOs/toChannelDTOs directly against the current
// filters/type/isActive/sharedWithGroups shape (see that file's own comment on why it's
// kept local rather than duplicated in this shared module).
type InsightDTOSource = Pick<
  InsightDocument,
  '_id' | 'orgId' | 'groupId' | 'projectIds' | 'name' | 'chartType' | 'sourceFilters' | 'config' | 'createdAt' | 'updatedAt'
> & { ownerId: PopulatedOwner };

export function toInsightDTO(insight: InsightDTOSource): Insight {
  return {
    id: asInsightId(insight._id.toString()),
    orgId: asOrgId(insight.orgId.toString()),
    ownerId: asUserId(insight.ownerId._id.toString()),
    ownerEmail: insight.ownerId.email,
    groupId: asGroupId(insight.groupId.toString()),
    projectIds: insight.projectIds.map((id) => id.toString()),
    name: insight.name,
    chartType: insight.chartType,
    // Mixed on the Mongoose schema (validated at the zod layer, not re-typed there — see
    // insight.model.ts's own comment) — safe to cast back to its shared shape here.
    sourceFilters: insight.sourceFilters as unknown as FilterPanelState,
    config: insight.config as unknown as InsightConfig,
    createdAt: insight.createdAt.toISOString(),
    updatedAt: insight.updatedAt.toISOString(),
  };
}

// Only the scalar fields are read here — `insights`/`layout` are resolved separately by the
// caller (dashboard.routes.ts's resolveDashboardDTO) since turning the stored
// IDashboardInsight[]/IDashboardLayoutItem[] refs into DashboardInsightRef[] (with each
// insight's live name/chartType) requires a DB lookup, which this synchronous module never
// does itself.
type DashboardDTOSource = Pick<
  DashboardDocument,
  '_id' | 'orgId' | 'groupId' | 'ownerId' | 'projectId' | 'name' | 'createdAt' | 'updatedAt'
>;

export function toDashboardDTO(
  dashboard: DashboardDTOSource,
  insights: DashboardInsightRef[],
  layout: DashboardLayoutItem[],
): Dashboard {
  return {
    id: asDashboardId(dashboard._id.toString()),
    orgId: asOrgId(dashboard.orgId.toString()),
    groupId: asGroupId(dashboard.groupId.toString()),
    ownerId: asUserId(dashboard.ownerId.toString()),
    projectId: dashboard.projectId ? dashboard.projectId.toString() : null,
    name: dashboard.name,
    insights,
    layout,
    createdAt: dashboard.createdAt.toISOString(),
    updatedAt: dashboard.updatedAt.toISOString(),
  };
}

export function toGlobalSettingsDTO(settings: GlobalSettingsDocument): GlobalSettings {
  return {
    id: asGlobalSettingsId(settings._id.toString()),
    orgId: asOrgId(settings.orgId.toString()),
    maxSnapshotArticles: settings.maxSnapshotArticles,
    msTeams: {
      hideIcons: settings.msTeams.hideIcons,
      maxArticlesPerShare: settings.msTeams.maxArticlesPerShare,
      defaultBulkMessage: settings.msTeams.defaultBulkMessage,
    },
    articleFieldMapping: {
      titleConceptKey: settings.articleFieldMapping.titleConceptKey ?? null,
      locationConceptKey: settings.articleFieldMapping.locationConceptKey ?? null,
      publishedDateConceptKey: settings.articleFieldMapping.publishedDateConceptKey ?? null,
    },
    updatedAt: settings.updatedAt.toISOString(),
  };
}

function toFilterLayoutItemDTO(item: IFilterLayoutItem): FilterLayoutItem {
  return {
    kind: item.kind,
    key: item.key,
    order: item.order,
    label: item.label,
  };
}

export function toFilterLayoutDTO(layout: FilterLayoutDocument): FilterLayout {
  return {
    id: layout._id.toString(),
    orgId: asOrgId(layout.orgId.toString()),
    projectId: layout.projectId ? asProjectId(layout.projectId.toString()) : null,
    items: layout.items.map(toFilterLayoutItemDTO),
    updatedAt: layout.updatedAt.toISOString(),
  };
}

function toEntityMappingEntryDTO(entry: IEntityMappingEntry): EntityMappingEntry {
  return {
    id: entry._id.toString(),
    upstreamType: entry.upstreamType,
    upstreamId: entry.upstreamId,
    upstreamName: entry.upstreamName,
    localType: entry.localType,
    localId: entry.localId,
    localName: entry.localName ?? null,
    lastSyncedAt: entry.lastSyncedAt ? entry.lastSyncedAt.toISOString() : null,
    status: entry.status,
  };
}

export function toEntityMappingDTO(mapping: EntityMappingDocument): EntityMapping {
  return {
    id: asEntityMappingId(mapping._id.toString()),
    orgId: asOrgId(mapping.orgId.toString()),
    upstreamSystem: mapping.upstreamSystem,
    entries: mapping.entries.map(toEntityMappingEntryDTO),
    updatedAt: mapping.updatedAt.toISOString(),
  };
}

export function toTeamsShareDTO(share: TeamsShareDocument): TeamsShareRecord {
  return {
    id: asTeamsShareId(share._id.toString()),
    orgId: asOrgId(share.orgId.toString()),
    sharedBy: asUserId(share.sharedBy.toString()),
    message: share.message,
    mentions: share.mentions,
    articleCount: share.articleCount,
    simulated: true,
    createdAt: share.createdAt.toISOString(),
  };
}
