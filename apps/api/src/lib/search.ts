import type {
  AdvancedConditionMode,
  AdvancedSearch,
  AdvancedSearchCondition,
  AdvancedSearchGroup,
  BooleanOperator,
  DateFilterValue,
  FacetBucket,
  FacetsResponse,
  FacetSortOrder,
  FilterPanelState,
  HardFilterGrant,
  SearchHit,
  SearchResponse,
  SearchSortOption,
  SourceTypeTab,
} from '@content-insights/shared';
import { normalizeFilterPanelState } from '@content-insights/shared';

import { esClient, getOrgIndexName, type EsArticleDocument } from './elasticsearch.js';

const HIGHLIGHT_FRAGMENT_SIZE = 150;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TEXT_SEARCH_FIELDS = ['title^3', 'summary^2', 'body'];
const DEFAULT_FACET_SIZE = 100;
// Never a real taxonomy value (concept-derived slugs are `[a-z0-9_]+`) — used as an ES
// `include` filter that can never match a real bucket, so a hard concept with zero
// granted values produces zero ES-side buckets even before the JS-side
// filterFacetBuckets() re-check (the authoritative guard; see its comment below) runs.
const NO_GRANT_SENTINEL = '__ci_no_grant__';

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

// HardFilterGrant (from @content-insights/shared) identifies a concept by
// conceptId/conceptName — it does not carry the concept's `key`, which is what the query
// builder actually needs to target the right `taxonomyValues.<key>` ES field. Resolving
// conceptId -> Concept.key is a Mongo lookup (ConceptModel), out of scope for this
// ES-only module, so the caller (a group/search service, built in a later phase) is
// expected to resolve it and pass the richer shape below.
//
// IMPORTANT — exhaustiveness contract: `hardFilterGrants` must contain one entry for
// EVERY hard-placement concept in the project(s) being searched, not just the ones the
// group happens to have a persisted grant row for. A hard concept the group has no grant
// row for must still appear here with `allowedValues: []` (see
// intersectSelectionWithGrant below for why that's what makes "no grant row = zero
// results" work). buildArticleSearchQuery has no other way to learn a hard concept
// exists — it only ever sees what's in this array.
// projectId identifies which project this specific hard concept belongs to. This matters
// because a group is very often granted MULTIPLE projects, each with its own hard-placement
// concept (e.g. every project defining its own "Website Domain/Source" concept) — without
// tracking which project each grant applies to, buildArticleFilterClauses had no way to
// avoid requiring a document to satisfy every granted project's hard concept simultaneously
// (see that function's own comment for the bug this fixes).
export interface HardFilterGrantWithKey extends HardFilterGrant {
  conceptKey: string;
  projectId: string;
}

export interface ArticleSearchGrants {
  projectIds: string[]; // ProjectId[] as string[] — every project the group may search
  hardFilterGrants: HardFilterGrantWithKey[];
  // Informational only. Soft filter concepts are never restricted at the query level —
  // they only affect which concept panels the UI *shows* — so this is not read by any
  // function below. Kept on the shape so callers don't have to strip it out.
  softFilterConceptKeys: string[];
}

// ---------------------------------------------------------------------------
// The hard business rule: selected ∩ granted
// ---------------------------------------------------------------------------

// The single most important function in this module. Used for both hard-filter concept
// values and project scoping, since the brief specifies identical semantics for both:
//   - No selection at all -> the full granted set (never narrower than what's granted).
//   - A selection that includes values outside the grant -> those values are silently
//     dropped; only the overlap survives.
//   - An empty grant (`allowedValues: []`, i.e. "no grant row for this concept") -> the
//     result is always `[]`, regardless of what was selected. An empty `terms` filter in
//     Elasticsearch matches zero documents, which is exactly how this becomes "everything
//     filtered out" once it reaches buildArticleSearchQuery — ungranted values can never
//     leak into results just because the user (or a replayed/forged request) selected them.
export function intersectSelectionWithGrant(
  selectedValues: string[] | undefined,
  allowedValues: string[],
): string[] {
  if (!selectedValues || selectedValues.length === 0) return allowedValues;
  if (allowedValues.length === 0) return [];
  const allowedSet = new Set(allowedValues);
  return selectedValues.filter((value) => allowedSet.has(value));
}

// ---------------------------------------------------------------------------
// Free-text query clause
// ---------------------------------------------------------------------------

// Advanced-looking plain queries (typed straight into the main search box, not through
// Advanced Search) get simple_query_string operator support; everything else gets fuzzy +
// phrase-prefix matching so typos and partial titles still hit.
function looksLikeAdvancedQuery(query: string): boolean {
  return /[+"|()*\-~]/.test(query);
}

function buildTextMustClause(trimmedQuery: string): Record<string, unknown> {
  if (looksLikeAdvancedQuery(trimmedQuery)) {
    return {
      simple_query_string: {
        query: trimmedQuery,
        fields: TEXT_SEARCH_FIELDS,
        default_operator: 'or',
        lenient: true,
      },
    };
  }

  return {
    bool: {
      should: [
        {
          multi_match: {
            query: trimmedQuery,
            fields: TEXT_SEARCH_FIELDS,
            type: 'best_fields',
            fuzziness: 'AUTO',
            operator: 'or',
          },
        },
        { multi_match: { query: trimmedQuery, fields: TEXT_SEARCH_FIELDS, type: 'phrase_prefix' } },
        {
          simple_query_string: {
            query: trimmedQuery,
            fields: TEXT_SEARCH_FIELDS,
            default_operator: 'or',
            lenient: true,
          },
        },
      ],
      minimum_should_match: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Date filter — "now" is always an explicit, injectable parameter
// ---------------------------------------------------------------------------

// Never resolve `lastNDays` to absolute dates at save time — only ever at query time —
// which is what makes a dynamic saved search "rolling." `now` defaults to the real clock
// for production callers but is an explicit parameter (not `new Date()` baked into the
// body) specifically so this is testable without mocking wall-clock time.
export function buildDateRangeFilter(
  dateFilter: DateFilterValue | null | undefined,
  now: Date,
): Record<string, unknown> | null {
  if (!dateFilter) return null;

  switch (dateFilter.mode) {
    case 'between': {
      if (!dateFilter.start && !dateFilter.end) return null;
      return {
        range: {
          publishedAt: {
            ...(dateFilter.start ? { gte: dateFilter.start } : {}),
            ...(dateFilter.end ? { lte: dateFilter.end } : {}),
          },
        },
      };
    }
    case 'untilNow': {
      if (!dateFilter.start) return null;
      return { range: { publishedAt: { gte: dateFilter.start, lte: now.toISOString() } } };
    }
    case 'lastNDays': {
      if (!dateFilter.lastNDays) return null;
      const start = new Date(now.getTime() - dateFilter.lastNDays * MS_PER_DAY);
      return { range: { publishedAt: { gte: start.toISOString(), lte: now.toISOString() } } };
    }
  }
}

// ---------------------------------------------------------------------------
// sourceTypeTab / hiddenArticles
// ---------------------------------------------------------------------------

// Legacy upstream 'external' source-type values are normalized to 'file_system' at
// ingest time (see ARTICLE_SOURCE_TYPES's note in
// @content-insights/shared/types/article.ts) — the query side never needs to special-case
// it, since by the time an article is indexed its sourceType is always 'news' |
// 'file_system'.
function buildSourceTypeFilter(tab: SourceTypeTab): Record<string, unknown> | null {
  switch (tab) {
    case 'news':
      return { term: { sourceType: 'news' } };
    case 'documents':
      return { term: { sourceType: 'file_system' } };
    case 'all':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Advanced Search
// ---------------------------------------------------------------------------

function resolveConditionFields(
  mode: AdvancedConditionMode,
  conceptKey: string | undefined,
  conceptKeys: string[] | undefined,
): string[] {
  switch (mode) {
    case 'text':
      return []; // text mode always searches TEXT_SEARCH_FIELDS via multi_match, see below
    case 'taxonomy':
      return conceptKey ? [`taxonomyValues.${conceptKey}`] : [];
    case 'crossConcept':
      return (conceptKeys ?? []).map((key) => `taxonomyValues.${key}`);
  }
}

// One selected value, as a query clause. `phrase` selects match_phrase/multi_match-phrase
// (used by matchLogic 'all'/'exact'); otherwise a looser match/multi_match (used by 'any'/
// 'none'). For crossConcept mode (multiple taxonomy fields), the per-field clauses are
// OR'd together (should, minimum_should_match: 1) — "searches across all listed
// conceptKeys" per the brief — since a single value only needs to hit ONE of the listed
// concepts to count as a match for that value.
function buildValueClause(
  mode: AdvancedConditionMode,
  value: string,
  fields: string[],
  phrase: boolean,
): Record<string, unknown> {
  if (mode === 'text') {
    return { multi_match: { query: value, fields: TEXT_SEARCH_FIELDS, type: phrase ? 'phrase' : 'best_fields' } };
  }
  const matchType = phrase ? 'match_phrase' : 'match';
  const clauses = fields.map((field) => ({ [matchType]: { [field]: value } }));
  return clauses.length <= 1
    ? (clauses[0] ?? { match_all: {} })
    : { bool: { should: clauses, minimum_should_match: 1 } };
}

// Per-condition matchLogic governs how the condition's *values* combine (this is
// orthogonal to how crossConcept's fields combine, handled by buildValueClause above):
//   - 'all'   every value must match, as a full phrase             -> must[]  of match_phrase
//   - 'exact' full phrase match, any one value is enough            -> should[] of match_phrase, min 1
//   - 'any'   partial/word match, any one value is enough           -> should[] of match, min 1
//   - 'none'  must not match any of the values                      -> must_not[] of match
function buildAdvancedConditionQuery(condition: AdvancedSearchCondition): Record<string, unknown> {
  const { mode, conceptKey, conceptKeys, values, matchLogic } = condition;
  // An empty value list is a still-being-edited row, not "match nothing" — never let an
  // incomplete condition zero out the whole search.
  if (values.length === 0) return { match_all: {} };

  const fields = resolveConditionFields(mode, conceptKey, conceptKeys);

  switch (matchLogic) {
    case 'all':
      return { bool: { must: values.map((v) => buildValueClause(mode, v, fields, true)) } };
    case 'exact':
      return {
        bool: { should: values.map((v) => buildValueClause(mode, v, fields, true)), minimum_should_match: 1 },
      };
    case 'any':
      return {
        bool: { should: values.map((v) => buildValueClause(mode, v, fields, false)), minimum_should_match: 1 },
      };
    case 'none':
      return { bool: { must_not: values.map((v) => buildValueClause(mode, v, fields, false)) } };
  }
}

// Left-to-right fold over items whose OWN operatorToNext joins each item to the next one
// (operators are per-item, not a single global AND/OR for the whole list) — e.g. for
// groups [A -AND-> B -OR-> C] this builds ((A AND B) OR C), never a flat
// must:[A,B] / should:[A,B,C]. Used for both Advanced Search's group-to-group chaining and
// each group's own condition-to-condition chaining — same shape, different level.
function foldWithOperators<T>(
  items: T[],
  buildClause: (item: T) => Record<string, unknown>,
  getOperatorToNext: (item: T) => BooleanOperator,
): Record<string, unknown> | null {
  if (items.length === 0) return null;
  let acc = buildClause(items[0] as T);
  for (let i = 1; i < items.length; i++) {
    const operator = getOperatorToNext(items[i - 1] as T);
    const clause = buildClause(items[i] as T);
    acc =
      operator === 'AND'
        ? { bool: { must: [acc, clause] } }
        : { bool: { should: [acc, clause], minimum_should_match: 1 } };
  }
  return acc;
}

function buildAdvancedSearchGroupQuery(group: AdvancedSearchGroup): Record<string, unknown> {
  return foldWithOperators(group.conditions, buildAdvancedConditionQuery, (c) => c.operatorToNext) ?? {
    match_all: {},
  };
}

export function buildAdvancedSearchQuery(advancedSearch: AdvancedSearch): Record<string, unknown> | null {
  if (!advancedSearch.enabled) return null;
  const groups = advancedSearch.groups.filter((g) => g.conditions.length > 0);
  return foldWithOperators(groups, buildAdvancedSearchGroupQuery, (g) => g.operatorToNext);
}

// ---------------------------------------------------------------------------
// The core query builder
// ---------------------------------------------------------------------------

interface ArticleFilterClauses {
  filter: Record<string, unknown>[];
  must: Record<string, unknown>[];
}

// Shared by buildArticleSearchQuery and the facets builder below: identical filtering
// semantics, except that when `excludeConceptKey` is set, that one concept's own
// taxonomyValues selection is treated as absent — the standard "a facet never filters by
// its own currently-applied value" pattern, so counts reflect what selecting OTHER values
// for that concept would yield. Every other filter (including hard-filter grant
// enforcement for the excluded concept itself, which is a security floor, not a
// user-toggleable filter) still applies.
function buildArticleFilterClauses(
  filters: FilterPanelState,
  grants: ArticleSearchGrants,
  now: Date,
  excludeConceptKey?: string,
): ArticleFilterClauses {
  // Mongoose minimize can strip empty taxonomyValues/userTagIds/etc. from persisted
  // FilterPanelState (insights sourceFilters, saved searches). Normalize once here so every
  // ES search/facet/chart path is safe — not just the few call sites that remember to.
  filters = normalizeFilterPanelState(filters);

  const filter: Record<string, unknown>[] = [];
  const must: Record<string, unknown>[] = [];

  // Project scoping — never trust filters.projectIds alone; intersect with what the
  // group is actually granted, same selected-∩-granted rule as hard filter concepts.
  const effectiveProjectIds = intersectSelectionWithGrant(filters.projectIds, grants.projectIds);
  filter.push({ terms: { projectId: effectiveProjectIds } });

  // Hard filter concepts — mandatory, non-bypassable. A group is very often granted
  // MULTIPLE projects, each defining its OWN hard-placement concept (e.g. every project
  // having its own "Website Domain/Source" concept — possibly even sharing the same key).
  // Each such grant must only ever constrain documents that actually belong to ITS OWN
  // project — never documents from a different granted project, which won't carry that
  // concept's field at all (or may carry an unrelated value under a same-named key). So
  // hard grants are grouped by projectId and OR'd together per-project (each project's own
  // branch AND-ing just its own hard concept(s)), rather than a single flat AND across every
  // granted project's grants regardless of which project a given document belongs to — the
  // latter previously made search/facets return zero (or wrongly incomplete) results for any
  // multi-project group with hard-placement concepts, since a document could never
  // simultaneously satisfy a DIFFERENT project's unrelated grant.
  const hardConceptKeys = new Set(grants.hardFilterGrants.map((g) => g.conceptKey));
  const relevantHardGrants = grants.hardFilterGrants.filter((g) => effectiveProjectIds.includes(g.projectId));
  if (relevantHardGrants.length > 0) {
    const grantsByProject = new Map<string, HardFilterGrantWithKey[]>();
    for (const grant of relevantHardGrants) {
      const list = grantsByProject.get(grant.projectId);
      if (list) list.push(grant);
      else grantsByProject.set(grant.projectId, [grant]);
    }

    const perProjectClauses: Record<string, unknown>[] = effectiveProjectIds.map((projectId) => {
      const projectGrants = grantsByProject.get(projectId) ?? [];
      if (projectGrants.length === 0) {
        // This project has no hard-placement concept at all — nothing further to restrict
        // beyond the outer project-scoping filter already pushed above.
        return { term: { projectId } };
      }
      // The concept being faceted is treated as if nothing were selected for it (falls back
      // to the full granted set) rather than dropped outright — the grant ceiling itself is
      // never optional, only the user's own narrowing selection is.
      const branchMust: Record<string, unknown>[] = [{ term: { projectId } }];
      for (const grant of projectGrants) {
        const selected =
          grant.conceptKey === excludeConceptKey ? undefined : filters.taxonomyValues[grant.conceptKey];
        const effective = intersectSelectionWithGrant(selected, grant.allowedValues);
        branchMust.push({ terms: { [`taxonomyValues.${grant.conceptKey}`]: effective } });
      }
      return { bool: { must: branchMust } };
    });

    filter.push({ bool: { should: perProjectClauses, minimum_should_match: 1 } });
  }

  // Everything else in taxonomyValues (soft concepts, or any concept key with no hard
  // grant entry at all) — plain OR-within-key, AND-across-keys, no grant restriction:
  // soft filters only affect which concept panels the UI shows, never what's searchable.
  for (const [conceptKey, values] of Object.entries(filters.taxonomyValues)) {
    if (hardConceptKeys.has(conceptKey)) continue; // already handled above
    if (conceptKey === excludeConceptKey) continue; // facet excludes its own filter
    if (values.length > 0) filter.push({ terms: { [`taxonomyValues.${conceptKey}`]: values } });
  }

  filter.push({ term: { hidden: filters.hiddenArticles === 'onlyHidden' } });

  const sourceTypeFilter = buildSourceTypeFilter(filters.sourceTypeTab);
  if (sourceTypeFilter) filter.push(sourceTypeFilter);

  const dateRangeFilter = buildDateRangeFilter(filters.dateFilter, now);
  if (dateRangeFilter) filter.push(dateRangeFilter);

  if (filters.userTagIds.length > 0) filter.push({ terms: { tagIds: filters.userTagIds } });

  const trimmedQuery = filters.query.trim();
  if (trimmedQuery) must.push(buildTextMustClause(trimmedQuery));

  const advancedClause = buildAdvancedSearchQuery(filters.advancedSearch);
  if (advancedClause) must.push(advancedClause);

  return { filter, must };
}

// The core of this phase: builds the full ES bool query for an article search, enforcing
// project scoping and hard-filter concept grants no matter what the caller's own filter
// selection says. `now` defaults to the real clock but is threaded through explicitly
// (see buildDateRangeFilter) so dynamic ("rolling") date windows are testable.
export function buildArticleSearchQuery(
  filters: FilterPanelState,
  grants: ArticleSearchGrants,
  now: Date = new Date(),
): Record<string, unknown> {
  const { filter, must } = buildArticleFilterClauses(filters, grants, now);
  return { bool: { ...(must.length > 0 ? { must } : {}), filter } };
}

// ---------------------------------------------------------------------------
// Sort / pagination
// ---------------------------------------------------------------------------

function buildSortClause(sort: SearchSortOption): Array<Record<string, unknown>> {
  switch (sort) {
    case 'relevance':
      return [{ _score: 'desc' }, { publishedAt: 'desc' }];
    case 'date_desc':
      return [{ publishedAt: 'desc' }];
    case 'date_asc':
      return [{ publishedAt: 'asc' }];
    case 'title_asc':
      return [{ 'title.keyword': 'asc' }];
    case 'title_desc':
      return [{ 'title.keyword': 'desc' }];
  }
}

export interface ArticleSearchParams {
  filters: FilterPanelState;
  grants: ArticleSearchGrants;
  // Matches searchRequestSchema (POST /api/search) exactly — page/size, not a raw ES
  // `from`. Page sizes (50 list / 4 grid2x2 / 12 grid3x4) are never hardcoded here; the
  // caller passes whatever `size` it wants and this module just turns it into `from`.
  page: number;
  size: number;
  now?: Date | undefined;
}

// Separated from executeArticleSearch so query-building is unit-testable without a live
// ES connection.
export function buildArticleSearchRequestBody(params: ArticleSearchParams): Record<string, unknown> {
  const { filters, grants, page, size, now } = params;
  return {
    query: buildArticleSearchQuery(filters, grants, now),
    highlight: {
      fields: {
        body: { fragment_size: HIGHLIGHT_FRAGMENT_SIZE },
        summary: { number_of_fragments: 0 },
        title: { number_of_fragments: 0 },
      },
      pre_tags: ['<mark>'],
      post_tags: ['</mark>'],
    },
    sort: buildSortClause((filters.sort as SearchSortOption) || 'relevance'),
    from: (page - 1) * size,
    size,
    track_total_hits: true,
  };
}

export interface ExecuteArticleSearchParams extends ArticleSearchParams {
  orgId: string;
}

export async function executeArticleSearch(params: ExecuteArticleSearchParams): Promise<SearchResponse> {
  const { orgId, page, size } = params;
  const index = getOrgIndexName(orgId);
  const body = buildArticleSearchRequestBody(params);

  const response = await esClient.search<EsArticleDocument>({ index, ...body });

  const totalRaw = response.hits.total;
  const total = typeof totalRaw === 'number' ? totalRaw : (totalRaw?.value ?? 0);

  const hits: SearchHit[] = response.hits.hits.map((hit) => {
    const source = hit._source;
    const fragments = [...(hit.highlight?.title ?? []), ...(hit.highlight?.summary ?? []), ...(hit.highlight?.body ?? [])];
    const highlight =
      fragments.length > 0 ? fragments.join(' … ') : (source?.summary ?? '').slice(0, HIGHLIGHT_FRAGMENT_SIZE);
    return {
      articleId: source?.articleId ?? hit._id ?? '',
      title: source?.title ?? '',
      summary: source?.summary ?? '',
      domain: source?.domain ?? '',
      sourceType: source?.sourceType ?? 'news',
      publishedAt: source?.publishedAt ?? new Date(0).toISOString(),
      score: hit._score ?? 0,
      highlight,
      taxonomyValues: source?.taxonomyValues ?? {},
      tagIds: source?.tagIds ?? [],
      hidden: source?.hidden ?? false,
      createdAt: source?.createdAt ?? new Date(0).toISOString(),
    };
  });

  return { hits, total, page, size, took: response.took ?? 0 };
}

// ---------------------------------------------------------------------------
// Facets — live per-concept filter counts
// ---------------------------------------------------------------------------

export function sortFacetBuckets(buckets: FacetBucket[], sort: FacetSortOrder): FacetBucket[] {
  const sorted = [...buckets];
  switch (sort) {
    case 'az':
      sorted.sort((a, b) => a.key.localeCompare(b.key));
      break;
    case 'za':
      sorted.sort((a, b) => b.key.localeCompare(a.key));
      break;
    case 'countAsc':
      sorted.sort((a, b) => a.count - b.count);
      break;
    case 'countDesc':
      sorted.sort((a, b) => b.count - a.count);
      break;
  }
  return sorted;
}

export interface FilterFacetBucketsOptions {
  excludeZeroCounts?: boolean | undefined;
  // When set, any bucket whose key is not in this list is dropped — the JS-side
  // enforcement of "never surface a bucket value outside the group's
  // hardFilterGrants.allowedValues for a hard concept." This is the AUTHORITATIVE guard:
  // it holds even if the ES-side `include` restriction (see buildFacetTermsAgg) were ever
  // wrong, bypassed, or skipped.
  allowedValues?: string[] | undefined;
}

export function filterFacetBuckets(
  buckets: FacetBucket[],
  options: FilterFacetBucketsOptions,
): FacetBucket[] {
  let result = buckets;
  if (options.allowedValues) {
    const allowed = new Set(options.allowedValues);
    result = result.filter((b) => allowed.has(b.key));
  }
  if (options.excludeZeroCounts) {
    result = result.filter((b) => b.count > 0);
  }
  return result;
}

function buildFacetTermsAgg(
  conceptKey: string,
  grant: HardFilterGrantWithKey | undefined,
  size: number,
): Record<string, unknown> {
  const field = `taxonomyValues.${conceptKey}`;
  if (!grant) return { field, size };
  // Hard concept: bound the aggregation to the granted superset (or the sentinel if
  // ungranted, guaranteeing zero ES-side buckets) and allow zero-count buckets through —
  // callers with excludeZeroCounts:false can then show every grantable value, even ones
  // with no current matches.
  return {
    field,
    size,
    min_doc_count: 0,
    include: grant.allowedValues.length > 0 ? grant.allowedValues : [NO_GRANT_SENTINEL],
  };
}

export interface ArticleFacetsParams {
  filters: FilterPanelState;
  grants: ArticleSearchGrants;
  conceptKeys: string[];
  sort: FacetSortOrder;
  excludeZeroCounts?: boolean | undefined;
  size?: number | undefined;
  now?: Date | undefined;
}

// Each requested concept gets its own sibling `filter` aggregation — built from
// buildArticleFilterClauses with THAT concept excluded — under a `match_all` top query, so
// excluding concept K's own filter never accidentally gets re-applied by an outer query
// context (a `filter` agg only narrows further than its parent query; it can't widen past
// filters already applied above it). `total` is a sibling agg using the FULL,
// nothing-excluded query, matching what the hit-search endpoint would return.
export function buildArticleFacetsRequestBody(params: ArticleFacetsParams): Record<string, unknown> {
  const { filters, grants, conceptKeys, size = DEFAULT_FACET_SIZE, now: nowParam } = params;
  const now = nowParam ?? new Date();

  const aggs: Record<string, unknown> = {
    total: { filter: buildArticleSearchQuery(filters, grants, now) },
  };
  for (const conceptKey of conceptKeys) {
    const { filter, must } = buildArticleFilterClauses(filters, grants, now, conceptKey);
    const grant = grants.hardFilterGrants.find((g) => g.conceptKey === conceptKey);
    aggs[conceptKey] = {
      filter: { bool: { ...(must.length > 0 ? { must } : {}), filter } },
      aggs: { values: { terms: buildFacetTermsAgg(conceptKey, grant, size) } },
    };
  }

  return { query: { match_all: {} }, size: 0, aggs };
}

interface RawFacetFilterAgg {
  doc_count: number;
  values?: { buckets?: Array<{ key: string; doc_count: number }> };
}

export async function executeArticleFacets(
  orgId: string,
  params: ArticleFacetsParams,
): Promise<FacetsResponse> {
  const index = getOrgIndexName(orgId);
  const body = buildArticleFacetsRequestBody(params);

  const response = await esClient.search<EsArticleDocument>({ index, ...body });
  const raw = (response.aggregations ?? {}) as Record<string, RawFacetFilterAgg>;

  const total = raw.total?.doc_count ?? 0;
  const facets: Record<string, FacetBucket[]> = {};
  for (const conceptKey of params.conceptKeys) {
    const rawBuckets = raw[conceptKey]?.values?.buckets ?? [];
    const buckets: FacetBucket[] = rawBuckets.map((b) => ({ key: b.key, count: b.doc_count }));
    const grant = params.grants.hardFilterGrants.find((g) => g.conceptKey === conceptKey);
    const filtered = filterFacetBuckets(buckets, {
      excludeZeroCounts: params.excludeZeroCounts,
      allowedValues: grant?.allowedValues,
    });
    facets[conceptKey] = sortFacetBuckets(filtered, params.sort);
  }

  return { facets, total };
}
