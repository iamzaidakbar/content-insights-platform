import type { OrgId, TagId } from '../ids.js';

export interface Tag {
  id: TagId;
  orgId: OrgId;
  name: string;
  color: string;
  count: number;
  createdAt: string;
  updatedAt: string;
}
