import type { GroupId, OrgId, UserId, UserTagId } from '../ids.js';

export const USER_TAG_NAME_MAX_LENGTH = 25;

export interface UserTagShareGrant {
  groupId: GroupId;
  groupName: string;
  canUse: boolean;
  canDelete: boolean;
}

export interface UserTag {
  id: UserTagId;
  orgId: OrgId;
  name: string; // the tag value itself; <=25 chars; globally unique case-insensitive
  ownerGroupId: GroupId;
  ownerGroupName: string;
  isPrivate: boolean;
  isPublished: boolean;
  createdBy: UserId;
  sharedWithGroups: UserTagShareGrant[];
  articleCount: number;
  createdAt: string;
  updatedAt: string;
}
