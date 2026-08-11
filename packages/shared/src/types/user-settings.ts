import type { OrgId, UserId, UserSettingsId } from '../ids.js';
import type { FacetSortOrder } from './search-filters.js';

export type Theme = 'light' | 'dark' | 'system';

export const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'MMM D, YYYY', 'D MMM YYYY'] as const;
export type DateFormatPreference = (typeof DATE_FORMATS)[number];

export const RESULT_VIEW_MODES = ['list', 'grid2x2', 'grid3x4'] as const;
export type ResultViewMode = (typeof RESULT_VIEW_MODES)[number];

export interface UserSettings {
  id: UserSettingsId;
  userId: UserId;
  orgId: OrgId;
  theme: Theme;
  dateFormat: DateFormatPreference;
  facetSortOrder: FacetSortOrder;
  hideZeroCountFacets: boolean;
  cardContentLines: Record<string, number>; // keyed by ProjectId, plus a 'default' fallback key
  languagePreference: string;
  defaultResultView: ResultViewMode;
  updatedAt: string;
}

export type UserSettingsDefaults = Omit<UserSettings, 'id' | 'userId' | 'orgId' | 'updatedAt'>;

// Single source of truth for defaults — used both to seed a new UserSettings document on
// user creation and to answer GET /api/settings/defaults.
export const DEFAULT_USER_SETTINGS: UserSettingsDefaults = {
  theme: 'light',
  dateFormat: 'MMM D, YYYY',
  facetSortOrder: 'countDesc',
  hideZeroCountFacets: false,
  cardContentLines: { default: 3 },
  languagePreference: 'en',
  defaultResultView: 'list',
};
