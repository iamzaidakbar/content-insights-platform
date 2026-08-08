import type { OrgId, ProjectId, RoleId, UserId } from '../ids.js';

export interface ProjectMember {
  userId: UserId;
  userEmail: string;
  roleId: RoleId;
  roleName: string;
}

export interface Project {
  id: ProjectId;
  orgId: OrgId;
  name: string;
  description: string;
  members: ProjectMember[];
  createdAt: string;
  updatedAt: string;
}
