import type { GroupId, OrgId, SavedSearchId, UserId } from '../ids.js';
import type { FilterPanelState } from './search-filters.js';

export const SAVED_SEARCH_TYPES = ['dynamic', 'snapshot'] as const;
export type SavedSearchType = (typeof SAVED_SEARCH_TYPES)[number];

export interface SavedSearchShareGrant {
  groupId: GroupId;
  groupName: string;
}

export interface SavedSearch {
  id: SavedSearchId;
  orgId: OrgId;
  groupId: GroupId; // navbar group active at save time; drives base visibility rules
  ownerId: UserId;
  ownerEmail: string;
  name: string;
  normalizedName: string; // trim -> lowercase -> Unicode NFC; unique across the app while isActive
  type: SavedSearchType;
  filters: FilterPanelState;
  snapshotLocationHashes: string[]; // only populated when type === 'snapshot'
  isActive: boolean; // soft delete; false frees the name
  isChannel: boolean;
  channelName?: string | null;
  sharedWithGroups: SavedSearchShareGrant[];
  lastRunAt: string | null;
  newResultsCount: number; // org/global count as of lastRunAt; per-viewer state is separate, see channel.ts
  createdAt: string;
  updatedAt: string;
}

export const MAX_SNAPSHOT_NAME_LENGTH = 200; // sanity cap, not a business rule from the brief — pick something reasonable and consistent with other name fields
