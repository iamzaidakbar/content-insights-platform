import type { Organization, User } from '@content-insights/shared';
import { asOrgId, asRoleId, asUserId } from '@content-insights/shared';

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
