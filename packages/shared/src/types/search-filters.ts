export interface DateRangeFilter {
  // Widened to `| undefined` (not just `?`) — exactOptionalPropertyTypes: this flows
  // straight out of zod's .optional() (which infers `T | undefined`, not an absent key)
  // in the SearchRequestInput/UpdateUserSettingsInput call sites that pass it through.
  start?: string | undefined;
  end?: string | undefined;
}

export type ArticleContentType = 'news' | 'document' | 'report';

// The full active-filter shape shared by the Filter Panel, the Advanced Search modal, and
// UserSettings.search.lastUsedFilters — one type for all three so persisting/restoring never
// has to translate between slightly different shapes. Always sent/stored as a complete object
// (never a partial patch) — see lib/flatten.ts's isFlattenable guard on the API side, which
// treats this whole shape as one atomic leaf rather than decomposing it field-by-field.
export interface SearchFilters {
  dateRange: DateRangeFilter;
  sources: string[];
  contentType: ArticleContentType | null;
  // Tag *names*, not Tag catalog ids — there's no document-to-Tag association model yet,
  // so a card's displayed tag chips are plain strings with no id to reference. Keying by
  // name (rather than id) is what lets a filter-panel selection and a card-chip click
  // agree on the same value.
  tags: string[];
  languages: string[];
  projects: string[];
}

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  dateRange: {},
  sources: [],
  contentType: null,
  tags: [],
  languages: [],
  projects: [],
};
