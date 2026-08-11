import type { ChannelViewId, SavedSearchId, UserId } from '../ids.js';
import type { SavedSearch } from './saved-search.js';

export interface ChannelView {
  id: ChannelViewId;
  savedSearchId: SavedSearchId;
  userId: UserId;
  lastViewedAt: string;
  lastSeenResultCount: number;
}

export interface ChannelViewerState {
  lastViewedAt: string | null;
  hasNewArticles: boolean;
}

// The shape channel-listing endpoints return: a SavedSearch (with isChannel true) enriched
// with the requesting user's own view state, since "new articles" is per-viewer.
export interface SavedSearchWithViewerState extends SavedSearch {
  viewerState: ChannelViewerState;
}
