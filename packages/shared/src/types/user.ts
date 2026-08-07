import type { OrgId, RoleId, UserId } from '../ids.js';

export interface User {
  id: UserId;
  orgId: OrgId;
  email: string;
  roles: RoleId[];
  createdAt: string;
  updatedAt: string;
}
