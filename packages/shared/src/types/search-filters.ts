export const DATE_FILTER_MODES = ['between', 'untilNow', 'lastNDays'] as const;
export type DateFilterMode = (typeof DATE_FILTER_MODES)[number];

export interface DateFilterValue {
  mode: DateFilterMode;
  start?: string | null; // 'between' | 'untilNow'
  end?: string | null; // 'between' only
  lastNDays?: number | null; // 'lastNDays' only — stored as a relative offset, recalculated against "now" every time a dynamic saved search runs
}

export const TAXONOMY_MATCH_LOGICS = ['all', 'exact', 'any', 'none'] as const;
export type TaxonomyMatchLogic = (typeof TAXONOMY_MATCH_LOGICS)[number];

export const ADVANCED_CONDITION_MODES = ['text', 'taxonomy', 'crossConcept'] as const;
export type AdvancedConditionMode = (typeof ADVANCED_CONDITION_MODES)[number];

export const BOOLEAN_OPERATORS = ['AND', 'OR'] as const;
export type BooleanOperator = (typeof BOOLEAN_OPERATORS)[number];

export interface AdvancedSearchCondition {
  id: string;
  mode: AdvancedConditionMode;
  conceptKey?: string; // required when mode === 'taxonomy'
  conceptKeys?: string[]; // required when mode === 'crossConcept'
  values: string[]; // free text terms, or taxonomy values
  matchLogic: TaxonomyMatchLogic; // free-text rows should mainly use 'any'/'none' but the field is always present
  operatorToNext: BooleanOperator; // joins to the next condition within the same group; ignored on the last condition
}

export interface AdvancedSearchGroup {
  id: string;
  conditions: AdvancedSearchCondition[];
  operatorToNext: BooleanOperator; // joins to the next group; ignored on the last group
}

export interface AdvancedSearch {
  enabled: boolean;
  groups: AdvancedSearchGroup[];
}

export const SOURCE_TYPE_TABS = ['all', 'news', 'documents'] as const;
export type SourceTypeTab = (typeof SOURCE_TYPE_TABS)[number];

export const FACET_SORT_ORDERS = ['az', 'za', 'countAsc', 'countDesc'] as const;
export type FacetSortOrder = (typeof FACET_SORT_ORDERS)[number];

export const HIDDEN_ARTICLES_MODES = ['exclude', 'onlyHidden'] as const;
export type HiddenArticlesMode = (typeof HIDDEN_ARTICLES_MODES)[number];

export interface FilterPanelState {
  query: string;
  sourceTypeTab: SourceTypeTab;
  hiddenArticles: HiddenArticlesMode;
  dateFilter: DateFilterValue | null;
  projectIds: string[]; // ProjectId[] as string[] to avoid a dependency cycle; empty = all accessible at runtime
  taxonomyValues: Record<string, string[]>; // conceptKey -> OR'd selected values; AND across different keys
  userTagIds: string[]; // UserTagId[] as string[]
  advancedSearch: AdvancedSearch;
  sort: string; // a SearchSortOption value (defined in search-result.ts; kept as string here to avoid a cycle)
}

export const EMPTY_ADVANCED_SEARCH: AdvancedSearch = { enabled: false, groups: [] };

export const EMPTY_FILTER_PANEL_STATE: FilterPanelState = {
  query: '',
  sourceTypeTab: 'all',
  hiddenArticles: 'exclude',
  dateFilter: null,
  projectIds: [],
  taxonomyValues: {},
  userTagIds: [],
  advancedSearch: EMPTY_ADVANCED_SEARCH,
  sort: 'date_desc',
};

/**
 * Rehydrate a FilterPanelState that may have been persisted with Mongoose `minimize`
 * (empty objects/arrays stripped) or otherwise partial. Always returns a full state
 * safe for Object.entries / .length / spread without null checks at every call site.
 */
export function normalizeFilterPanelState(
  filters: Partial<FilterPanelState> | null | undefined,
): FilterPanelState {
  const input = filters ?? {};
  return {
    ...EMPTY_FILTER_PANEL_STATE,
    ...input,
    projectIds: input.projectIds ?? [],
    taxonomyValues: input.taxonomyValues ?? {},
    userTagIds: input.userTagIds ?? [],
    advancedSearch: input.advancedSearch ?? EMPTY_ADVANCED_SEARCH,
  };
}

/** Query param that holds compact JSON for the live Articles filter/page state. */
export const ARTICLES_FILTERS_PARAM = 'f';

export interface ArticlesUrlState {
  filters: FilterPanelState;
  page: number;
}

function isEmptyObject(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}

/**
 * Compact JSON of non-default FilterPanelState fields plus page (>1). Used as the `f`
 * query param so an Articles view is shareable and Back/refresh round-trip.
 */
export function serializeArticlesUrlState(filters: FilterPanelState, page: number): string {
  const compact: Record<string, unknown> = {};
  if (filters.query) compact.query = filters.query;
  if (filters.sourceTypeTab !== EMPTY_FILTER_PANEL_STATE.sourceTypeTab) {
    compact.sourceTypeTab = filters.sourceTypeTab;
  }
  if (filters.hiddenArticles !== EMPTY_FILTER_PANEL_STATE.hiddenArticles) {
    compact.hiddenArticles = filters.hiddenArticles;
  }
  if (filters.dateFilter) compact.dateFilter = filters.dateFilter;
  if (filters.projectIds.length > 0) compact.projectIds = filters.projectIds;
  if (Object.keys(filters.taxonomyValues).length > 0) compact.taxonomyValues = filters.taxonomyValues;
  if (filters.userTagIds.length > 0) compact.userTagIds = filters.userTagIds;
  if (filters.advancedSearch.enabled) compact.advancedSearch = filters.advancedSearch;
  if (filters.sort !== EMPTY_FILTER_PANEL_STATE.sort) compact.sort = filters.sort;
  if (page > 1) compact.page = page;
  return JSON.stringify(compact);
}

export function parseArticlesUrlState(raw: string | null | undefined): ArticlesUrlState | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const rawPage = record.page;
    const page = typeof rawPage === 'number' && Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
    const { page: _ignored, ...rest } = record;
    return { filters: normalizeFilterPanelState(rest as Partial<FilterPanelState>), page };
  } catch {
    return null;
  }
}

export function isEmptyArticlesUrlState(serialized: string): boolean {
  try {
    const parsed = JSON.parse(serialized) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && isEmptyObject(parsed as Record<string, unknown>);
  } catch {
    return false;
  }
}
