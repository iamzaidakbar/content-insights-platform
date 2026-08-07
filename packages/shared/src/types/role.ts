import type { OrgId, RoleId } from '../ids.js';

export interface Role {
  id: RoleId;
  orgId: OrgId;
  name: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}
