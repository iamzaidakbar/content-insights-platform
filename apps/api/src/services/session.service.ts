import { randomUUID } from 'node:crypto';

import { asGroupId, asOrgId, asRoleId, asUserId, type AuthSession } from '@content-insights/shared';

import { signAccessToken, signRefreshToken, type AccessTokenRoleAssignment } from '../lib/jwt.js';
import { resolveEffectivePermissions } from '../lib/permissions.js';
import { registerRefreshToken } from '../lib/refresh-store.js';
import { resolveUserDTO } from '../lib/role-assignment-lookup.js';
import { toOrganizationDTO } from '../lib/serializers.js';
import type { OrganizationDocument } from '../models/organization.model.js';
import type { RoleDocument } from '../models/role.model.js';
import { UserModel, type UserDocument } from '../models/user.model.js';

export interface IssuedSession {
  authSession: AuthSession;
  refreshToken: string;
}

// Extracted out of auth.routes.ts so the SSO callback can issue a session the same way
// local login does, without duplicating this logic. Async because every refresh token is
// registered server-side (lib/refresh-store.ts) for rotation/revocation.
//
// `roles` must cover every roleId referenced by `user.roleAssignments` (any assignment
// pointing at a roleId missing from this list simply grants nothing — see
// resolveEffectivePermissions) so the embedded roleAssignments and denormalized
// globalPermissions stay consistent with each other.
export async function issueSession(
  user: UserDocument,
  org: OrganizationDocument,
  roles: RoleDocument[],
): Promise<IssuedSession> {
  const userId = asUserId(user._id.toString());
  const orgId = asOrgId(org._id.toString());

  const effective = resolveEffectivePermissions(user, roles);
  const globalPermissions = Array.from(effective.global);

  const roleAssignments: AccessTokenRoleAssignment[] = user.roleAssignments.map((assignment) => ({
    roleId: asRoleId(assignment.roleId.toString()),
    groupId: assignment.groupId ? asGroupId(assignment.groupId.toString()) : null,
    startDate: assignment.startDate ? assignment.startDate.toISOString() : null,
    endDate: assignment.endDate ? assignment.endDate.toISOString() : null,
  }));

  await UserModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  user.lastLoginAt = new Date();

  const accessToken = signAccessToken({
    sub: userId,
    orgId,
    email: user.email,
    roleAssignments,
    globalPermissions,
  });
  const jti = randomUUID();
  const refreshToken = signRefreshToken(userId, jti);
  await registerRefreshToken(jti, userId);

  return {
    authSession: {
      accessToken,
      user: await resolveUserDTO(orgId, user),
      org: toOrganizationDTO(org),
      permissions: globalPermissions,
    },
    refreshToken,
  };
}
