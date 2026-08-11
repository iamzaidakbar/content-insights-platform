import type { ConceptId, GroupId, OrgId, ProjectId, RoleId, UserId } from '../ids.js';

export interface HardFilterGrant {
  conceptId: ConceptId;
  conceptName: string;
  allowedValues: string[];
  denialNote?: string | undefined;
}

export interface SoftFilterConceptGrant {
  conceptId: ConceptId;
  conceptName: string;
  order: number;
}

export interface GroupDataAccess {
  projectIds: ProjectId[];
  hardFilterGrants: HardFilterGrant[];
  softFilterConcepts: SoftFilterConceptGrant[];
}

export interface GroupMemberSummary {
  userId: UserId;
  userEmail: string;
  roleId: RoleId;
  roleName: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface Group {
  id: GroupId;
  orgId: OrgId;
  name: string;
  description: string;
  dataAccess: GroupDataAccess;
  // Response-only read-model: derived server-side from User.roleAssignments where
  // groupId matches this group. NOT a persisted array on the Group document itself, so
  // nothing else needs to keep it in sync — the API resolves it fresh by querying users.
  members: GroupMemberSummary[];
  createdAt: string;
  updatedAt: string;
}
