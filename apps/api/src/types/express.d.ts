import type { Logger } from 'pino';

import type { OrgId, Organization, UserId } from '@content-insights/shared';

export interface AuthenticatedUser {
  id: UserId;
  orgId: OrgId;
  roles: string[];
  permissions: string[];
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
