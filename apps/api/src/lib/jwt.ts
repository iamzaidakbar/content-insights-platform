import jsonwebtoken, { type JwtPayload } from 'jsonwebtoken';

import { asOrgId, asUserId, type OrgId, type UserId } from '@content-insights/shared';

// jsonwebtoken's CJS module isn't statically analyzable by Node's ESM loader
// for named exports (it assigns exports.sign/exports.verify individually
// rather than a single object-literal `module.exports = {...}`) — named
// `import { sign, verify }` type-checks fine (against the .d.ts) but throws
// "does not provide an export named 'sign'" at actual runtime. Default
// import + destructure avoids that.
const { sign, verify } = jsonwebtoken;

import { AppError } from './errors.js';

// Literal types (not widened to `string`) — jsonwebtoken's `expiresIn` expects
// the `StringValue` template-literal type from the `ms` package. Keep these
// as inferred `const` literals; do NOT add a `: string` annotation or the
// literal type widens to `string` and no longer satisfies `StringValue`.
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export interface AccessTokenClaims {
  sub: UserId;
  orgId: OrgId;
  roles: string[];
  permissions: string[];
}

function getAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET is not set');
  }
  return secret;
}

function getRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new Error('JWT_REFRESH_SECRET is not set');
  }
  return secret;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return sign(claims, getAccessSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

export function signRefreshToken(userId: UserId): string {
  return sign({ sub: userId }, getRefreshSecret(), { expiresIn: REFRESH_TOKEN_TTL });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = verify(token, getAccessSecret());
  if (typeof decoded === 'string') {
    throw new AppError(401, 'UNAUTHORIZED', 'Malformed access token');
  }
  return parseAccessClaims(decoded);
}

export function verifyRefreshToken(token: string): UserId {
  const decoded = verify(token, getRefreshSecret());
  if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Malformed refresh token');
  }
  return asUserId(decoded.sub);
}

function parseAccessClaims(decoded: JwtPayload): AccessTokenClaims {
  const { sub, orgId, roles, permissions } = decoded;
  if (
    typeof sub !== 'string' ||
    typeof orgId !== 'string' ||
    !Array.isArray(roles) ||
    !Array.isArray(permissions)
  ) {
    throw new AppError(401, 'UNAUTHORIZED', 'Malformed access token claims');
  }
  return {
    sub: asUserId(sub),
    orgId: asOrgId(orgId),
    roles: roles as string[],
    permissions: permissions as string[],
  };
}
