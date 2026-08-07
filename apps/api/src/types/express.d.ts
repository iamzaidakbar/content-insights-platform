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
    }
  }
}

export {};
