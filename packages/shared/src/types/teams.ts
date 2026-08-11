import type { OrgId, TeamsShareId, UserId } from '../ids.js';

export interface TeamsShareArticleRef {
  title: string;
  url: string;
}

export interface TeamsShareRequest {
  message: string;
  mentions: string[];
  articles: TeamsShareArticleRef[];
  useAppDeepLink: boolean; // true = app deep link, false = original source URL
}

// No live MS Graph credentials are configured in this environment, so a "share" is recorded
// here rather than posted to a real Teams channel — swap in a real Graph API call behind this
// same shape once OAuth credentials are available.
export interface TeamsShareRecord {
  id: TeamsShareId;
  orgId: OrgId;
  sharedBy: UserId;
  message: string;
  mentions: string[];
  articleCount: number;
  simulated: true;
  createdAt: string;
}
