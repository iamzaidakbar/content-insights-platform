import type { Logger } from 'pino';

import type { OrgId, Organization, UserId } from '@content-insights/shared';

import type { AccessTokenRoleAssignment } from '../lib/jwt.js';

export interface AuthenticatedUser {
  id: UserId;
  orgId: OrgId;
  email: string;
  // Scope (groupId) + time bounds only — see AccessTokenRoleAssignment's own comment
  // (lib/jwt.ts) for why those two are trusted straight from the token while permissions
  // and group data access are always re-resolved fresh per request.
  roleAssignments: AccessTokenRoleAssignment[];
  // Denormalized GLOBAL-scope resolved permission set — see lib/permissions.ts's
  // resolveEffectivePermissions. May contain the '*' wildcard sentinel.
  globalPermissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      orgId?: OrgId;
      org?: Organization;
      /** UUID assigned by the requestId middleware — set before any route handler runs. */
      id: string;
      /** pino child logger pre-tagged with this request's id. */
      log: Logger;
    }
  }
}

export {};
