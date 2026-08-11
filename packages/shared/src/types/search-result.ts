// Named SearchSortOption (not SearchSort) — user-settings.ts's ResultViewMode/other
// preference types have different values.
export const SEARCH_SORT_OPTIONS = [
  'relevance',
  'date_desc',
  'date_asc',
  'title_asc',
  'title_desc',
] as const;
export type SearchSortOption = (typeof SEARCH_SORT_OPTIONS)[number];

export interface SearchHit {
  articleId: string;
  title: string;
  summary: string;
  domain: string;
  sourceType: string;
  publishedAt: string;
  score: number;
  highlight: string;
  taxonomyValues: Record<string, string[]>;
  tagIds: string[];
  hidden: boolean;
  createdAt: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  total: number;
  page: number;
  size: number;
  took: number;
}

// ---------------------------------------------------------------------------
// Facets — live filter counts (POST /api/search/facets)
// ---------------------------------------------------------------------------

export interface FacetBucket {
  key: string;
  count: number;
}

export interface FacetsResponse {
  // Keyed by concept key, or a system key like 'sourceType'/'project'/'userTags'.
  facets: Record<string, FacetBucket[]>;
  total: number;
}
