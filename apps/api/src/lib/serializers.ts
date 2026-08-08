import type {
  Document,
  Organization,
  Project,
  ProjectMember,
  Role,
  User,
  UserSettings,
} from '@content-insights/shared';
import {
  asDocumentId,
  asOrgId,
  asProjectId,
  asRoleId,
  asUserId,
  asUserSettingsId,
} from '@content-insights/shared';

import type { DocumentDocument } from '../models/document.model.js';
import type { OrganizationDocument } from '../models/organization.model.js';
import type { ProjectDocument } from '../models/project.model.js';
import type { RoleDocument } from '../models/role.model.js';
import type { UserDocument } from '../models/user.model.js';
import type { UserSettingsDocument } from '../models/userSettings.model.js';

export function toOrganizationDTO(org: OrganizationDocument): Organization {
  return {
    id: asOrgId(org._id.toString()),
    name: org.name,
    slug: org.slug,
    plan: org.plan,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}

export function toUserDTO(user: UserDocument): User {
  return {
    id: asUserId(user._id.toString()),
    orgId: asOrgId(user.orgId.toString()),
    email: user.email,
    roles: user.roles.map((roleId) => asRoleId(roleId.toString())),
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
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

export function toProjectMemberDTO(member: { userId: UserDocument; roleId: RoleDocument }): ProjectMember {
  return {
    userId: asUserId(member.userId._id.toString()),
    userEmail: member.userId.email,
    roleId: asRoleId(member.roleId._id.toString()),
    roleName: member.roleId.name,
  };
}

// Only the non-`members` fields are read here — `members` is passed in separately, already
// resolved. Narrowing the param to just those fields (rather than the full `ProjectDocument`)
// sidesteps a Mongoose `.populate<T>()` typing quirk: a populated doc's `.members` type no
// longer structurally matches `IProject.members`, so the populated result isn't assignable to
// `ProjectDocument` even though every field this function actually touches is still present.
type ProjectDTOSource = Pick<ProjectDocument, '_id' | 'orgId' | 'name' | 'description' | 'createdAt' | 'updatedAt'>;

export function toProjectDTO(project: ProjectDTOSource, members: ProjectMember[]): Project {
  return {
    id: asProjectId(project._id.toString()),
    orgId: asOrgId(project.orgId.toString()),
    name: project.name,
    description: project.description,
    members,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export function toUserSettingsDTO(settings: UserSettingsDocument): UserSettings {
  return {
    id: asUserSettingsId(settings._id.toString()),
    userId: asUserId(settings.userId.toString()),
    orgId: asOrgId(settings.orgId.toString()),
    appearance: settings.appearance,
    search: settings.search,
    notifications: settings.notifications,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export function toDocumentDTO(doc: DocumentDocument): Document {
  return {
    id: asDocumentId(doc._id.toString()),
    orgId: asOrgId(doc.orgId.toString()),
    createdBy: asUserId(doc.createdBy.toString()),
    // exactOptionalPropertyTypes: omit the key entirely when absent, never assign undefined.
    ...(doc.projectId !== undefined ? { projectId: doc.projectId } : {}),
    title: doc.title,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    fileType: doc.fileType,
    fileSizeBytes: doc.fileSizeBytes,
    status: doc.status,
    metadata: doc.metadata,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
