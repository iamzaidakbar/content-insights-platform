import type { Document, Organization, User } from '@content-insights/shared';
import { asDocumentId, asOrgId, asRoleId, asUserId } from '@content-insights/shared';

import type { DocumentDocument } from '../models/document.model.js';
import type { OrganizationDocument } from '../models/organization.model.js';
import type { UserDocument } from '../models/user.model.js';

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
