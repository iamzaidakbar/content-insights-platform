import type { OrgId, ProjectId } from '../ids.js';

export interface Project {
  id: ProjectId;
  orgId: OrgId;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}
