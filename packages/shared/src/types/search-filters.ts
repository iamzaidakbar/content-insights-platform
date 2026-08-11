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
