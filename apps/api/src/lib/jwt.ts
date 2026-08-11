import jsonwebtoken, { type JwtPayload } from 'jsonwebtoken';

import {
  asOrgId,
  asUserId,
  type GroupId,
  type OrgId,
  type RoleId,
  type UserId,
} from '@content-insights/shared';

// jsonwebtoken's CJS module isn't statically analyzable by Node's ESM loader
// for named exports (it assigns exports.sign/exports.verify individually
// rather than a single object-literal `module.exports = {...}`) — named
// `import { sign, verify }` type-checks fine (against the .d.ts) but throws
// "does not provide an export named 'sign'" at actual runtime. Default
// import + destructure avoids that.
const { sign, verify } = jsonwebtoken;

import { config } from './config.js';
import { AppError } from './errors.js';

// Literal types (not widened to `string`) — jsonwebtoken's `expiresIn` expects
// the `StringValue` template-literal type from the `ms` package. Keep these
// as inferred `const` literals; do NOT add a `: string` annotation or the
// literal type widens to `string` and no longer satisfies `StringValue`.
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

// A roleAssignment as embedded in the access token — mirrors User.roleAssignments'
// scope (groupId) and time bounds (startDate/endDate) only. Deliberately does NOT carry
// roleName/groupName (those are response-only denormalizations, see @content-insights/shared's
// RoleAssignment) or resolved group-scoped permissions — those are always re-resolved fresh
// against live Role + Group.dataAccess data per request (see lib/group-scope.ts and
// middleware/requireScopedPermission.ts), since both can change independently of this
// token's 15-minute lifetime. Scope and time bounds themselves ARE safe to trust from the
// token: they live on the User document itself, which is re-read on every login/refresh.
export interface AccessTokenRoleAssignment {
  roleId: RoleId;
  groupId: GroupId | null;
  startDate: string | null;
  endDate: string | null;
}

export interface AccessTokenClaims {
  sub: UserId;
  orgId: OrgId;
  email: string;
  roleAssignments: AccessTokenRoleAssignment[];
  // Denormalized GLOBAL-scope (groupId: null) resolved permission set — see
  // lib/permissions.ts's resolveEffectivePermissions — for a zero-DB-hit fast path on
  // org-wide permission checks. May contain the '*' wildcard sentinel. Group-scoped checks
  // always re-resolve from the DB (see AccessTokenRoleAssignment's own comment above).
  globalPermissions: string[];
}

function getAccessSecret(): string {
  return config.jwtAccessSecret;
}

function getRefreshSecret(): string {
  return config.jwtRefreshSecret;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return sign(claims, getAccessSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

// jti ties the token to the server-side registry (lib/refresh-store.ts) — rotation and
// revocation both key on it.
export function signRefreshToken(userId: UserId, jti: string): string {
  return sign({ sub: userId, jti }, getRefreshSecret(), { expiresIn: REFRESH_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = verify(token, getAccessSecret());
  if (typeof decoded === 'string') {
    throw new AppError(401, 'UNAUTHORIZED', 'Malformed access token');
  }
  return parseAccessClaims(decoded);
}

export interface RefreshTokenClaims {
  userId: UserId;
  jti: string;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const decoded = verify(token, getRefreshSecret());
  if (
    typeof decoded === 'string' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.jti !== 'string'
  ) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Malformed refresh token');
  }
  return { userId: asUserId(decoded.sub), jti: decoded.jti };
}

function parseAccessClaims(decoded: JwtPayload): AccessTokenClaims {
  const { sub, orgId, email, roleAssignments, globalPermissions } = decoded;
  if (
    typeof sub !== 'string' ||
    typeof orgId !== 'string' ||
    !Array.isArray(roleAssignments) ||
    !Array.isArray(globalPermissions)
  ) {
    throw new AppError(401, 'UNAUTHORIZED', 'Malformed access token claims');
  }
  return {
    sub: asUserId(sub),
    orgId: asOrgId(orgId),
    // Tolerate tokens minted before the email claim existed (15m max lifetime).
    email: typeof email === 'string' ? email : '',
    // Trusts the token's signature for the shape (as `roles`/`permissions` already did
    // before this) rather than deep-validating every element — signAccessToken is the only
    // place that ever writes this claim.
    roleAssignments: roleAssignments as AccessTokenRoleAssignment[],
    globalPermissions: globalPermissions as string[],
  };
}
