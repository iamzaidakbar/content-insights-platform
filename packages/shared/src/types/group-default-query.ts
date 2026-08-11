import type { GroupDefaultQueryId, GroupId, OrgId, ProjectId, SavedSearchId } from '../ids.js';

export interface GroupDefaultQuery {
  id: GroupDefaultQueryId;
  orgId: OrgId;
  groupId: GroupId;
  projectId: ProjectId;
  savedSearchId: SavedSearchId;
  savedSearchName: string;
  createdAt: string;
  updatedAt: string;
}
