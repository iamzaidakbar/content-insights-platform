import type { OrgId, UserId, UserSettingsId } from '../ids.js';

export type Theme = 'light' | 'dark' | 'system';
export type FontSize = 'small' | 'medium' | 'large';
export type CardDensity = 'comfortable' | 'compact' | 'cozy';
export type SearchPageSize = 12 | 24 | 48;
export type SearchSort = 'publishDate' | 'relevance' | 'source';
export type SearchLayout = '1col' | '2col' | '3col' | 'dense';
export type OpenArticleIn = 'newTab' | 'sameTab' | 'sidePanel';
export type DigestFrequency = 'daily' | 'weekly';

export interface AppearanceSettings {
  theme: Theme;
  fontSize: FontSize;
  compactSidebar: boolean;
  cardDensity: CardDensity;
}

export interface SearchSettings {
  defaultPageSize: SearchPageSize;
  defaultSort: SearchSort;
  defaultLayout: SearchLayout;
  openArticleIn: OpenArticleIn;
}

export interface InAppAlertSettings {
  breakingNews: boolean;
  tagMatches: boolean;
  system: boolean;
}

export interface NotificationSettings {
  emailDigest: boolean;
  emailDigestFrequency: DigestFrequency;
  inAppAlerts: InAppAlertSettings;
}

export interface UserSettings {
  id: UserSettingsId;
  userId: UserId;
  orgId: OrgId;
  appearance: AppearanceSettings;
  search: SearchSettings;
  notifications: NotificationSettings;
  updatedAt: string;
}

// The shape GET /api/settings/defaults returns — no real record backs it (no auth, no
// userId/orgId/id to speak of), just the system defaults every new UserSettings is
// seeded with. Used by the frontend as a fallback before the user's real settings load.
export type UserSettingsDefaults = Pick<UserSettings, 'appearance' | 'search' | 'notifications'>;

// Single source of truth for defaults — used both to seed a new UserSettings document on
// user creation and to answer GET /api/settings/defaults. Values not given an explicit
// default in the schema spec (search.defaultSort, openArticleIn, the notification fields)
// are deliberately conservative choices: email digest opt-in (off by default), in-app
// alerts on (they don't leave the app, low-friction), newest-first search results.
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: 'dark',
  fontSize: 'medium',
  compactSidebar: false,
  cardDensity: 'comfortable',
};

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  defaultPageSize: 12,
  defaultSort: 'publishDate',
  defaultLayout: '3col',
  openArticleIn: 'newTab',
};

export const DEFAULT_IN_APP_ALERT_SETTINGS: InAppAlertSettings = {
  breakingNews: true,
  tagMatches: true,
  system: true,
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  emailDigest: false,
  emailDigestFrequency: 'weekly',
  inAppAlerts: DEFAULT_IN_APP_ALERT_SETTINGS,
};

export const DEFAULT_USER_SETTINGS: UserSettingsDefaults = {
  appearance: DEFAULT_APPEARANCE_SETTINGS,
  search: DEFAULT_SEARCH_SETTINGS,
  notifications: DEFAULT_NOTIFICATION_SETTINGS,
};
