import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILTER_PANEL_STATE,
  type AdvancedSearch,
  type AdvancedSearchCondition,
  type AdvancedSearchGroup,
  type BooleanOperator,
  type FilterPanelState,
} from '@content-insights/shared';

import {
  buildAdvancedSearchQuery,
  buildArticleFacetsRequestBody,
  buildArticleSearchQuery,
  buildArticleSearchRequestBody,
  buildDateRangeFilter,
  filterFacetBuckets,
  intersectSelectionWithGrant,
  sortFacetBuckets,
  type ArticleSearchGrants,
} from './search.js';

// Duplicated intentionally from search.ts's TEXT_SEARCH_FIELDS: mode:'text' Advanced
// Search conditions must search across title/summary/body via multi_match, per the brief.
// If this ever drifts from the real constant, these tests should fail loudly.
const TEXT_SEARCH_FIELDS = ['title^3', 'summary^2', 'body'];

function mkGrants(overrides: Partial<ArticleSearchGrants> = {}): ArticleSearchGrants {
  return { projectIds: ['proj-1'], hardFilterGrants: [], softFilterConceptKeys: [], ...overrides };
}

function mkFilters(overrides: Partial<FilterPanelState> = {}): FilterPanelState {
  return { ...EMPTY_FILTER_PANEL_STATE, ...overrides };
}

function getFilterArray(query: Record<string, unknown>): Array<Record<string, unknown>> {
  return (query.bool as { filter: Array<Record<string, unknown>> }).filter;
}

function findFilterContaining(
  query: Record<string, unknown>,
  needle: string,
): Record<string, unknown> | undefined {
  return getFilterArray(query).find((f) => JSON.stringify(f).includes(needle));
}

// ---------------------------------------------------------------------------
// The hard business rule: selected ∩ granted
// ---------------------------------------------------------------------------

describe('intersectSelectionWithGrant', () => {
  it('returns the full granted set when nothing was selected', () => {
    expect(intersectSelectionWithGrant(undefined, ['critical', 'high'])).toEqual(['critical', 'high']);
    expect(intersectSelectionWithGrant([], ['critical', 'high'])).toEqual(['critical', 'high']);
  });

  it('drops selected values that fall outside the grant, keeping only the overlap', () => {
    expect(intersectSelectionWithGrant(['critical', 'made-up', 'low'], ['critical', 'high', 'low'])).toEqual([
      'critical',
      'low',
    ]);
  });

  it('returns an empty array when the group has no grant row at all for the concept', () => {
    expect(intersectSelectionWithGrant(['critical'], [])).toEqual([]);
    expect(intersectSelectionWithGrant(undefined, [])).toEqual([]);
  });
});

describe('buildArticleSearchQuery — hard filter concept enforcement', () => {
  it('restricts a hard concept to the intersection of selected values and the grant', () => {
    const filters = mkFilters({ taxonomyValues: { severity: ['critical', 'low', 'made-up'] } });
    const grants = mkGrants({
      hardFilterGrants: [
        { conceptId: 'c1' as never, conceptKey: 'severity', conceptName: 'Severity', allowedValues: ['critical', 'high'], projectId: 'proj-1' },
      ],
    });

    const query = buildArticleSearchQuery(filters, grants);
    const severityFilter = findFilterContaining(query, 'taxonomyValues.severity');

    expect(severityFilter).toEqual({
      bool: {
        minimum_should_match: 1,
        should: [
          {
            bool: {
              must: [
                { term: { projectId: 'proj-1' } },
                { terms: { 'taxonomyValues.severity': ['critical'] } },
              ],
            },
          },
        ],
      },
    });
  });

  it('never widens a hard concept beyond its grant when the user selects nothing for it', () => {
    const filters = mkFilters(); // no taxonomyValues selection at all
    const grants = mkGrants({
      hardFilterGrants: [
        { conceptId: 'c1' as never, conceptKey: 'severity', conceptName: 'Severity', allowedValues: ['critical', 'high'], projectId: 'proj-1' },
      ],
    });

    const query = buildArticleSearchQuery(filters, grants);
    const severityFilter = findFilterContaining(query, 'taxonomyValues.severity');

    expect(severityFilter).toEqual({
      bool: {
        minimum_should_match: 1,
        should: [
          {
            bool: {
              must: [
                { term: { projectId: 'proj-1' } },
                { terms: { 'taxonomyValues.severity': ['critical', 'high'] } },
              ],
            },
          },
        ],
      },
    });
  });

  it('blocks every article for a hard concept the group has no grant row for at all', () => {
    const filters = mkFilters({ taxonomyValues: { severity: ['critical'] } });
    const grants = mkGrants({
      hardFilterGrants: [
        { conceptId: 'c1' as never, conceptKey: 'severity', conceptName: 'Severity', allowedValues: [], projectId: 'proj-1' },
      ],
    });

    const query = buildArticleSearchQuery(filters, grants);
    const severityFilter = findFilterContaining(query, 'taxonomyValues.severity');

    // An empty `terms` filter matches zero documents in Elasticsearch — this IS how
    // "no grant row" becomes "everything filtered out." Nested under the per-project
    // hard-filter branch so an empty grant in one project cannot leak into another.
    expect(severityFilter).toEqual({
      bool: {
        minimum_should_match: 1,
        should: [
          {
            bool: {
              must: [
                { term: { projectId: 'proj-1' } },
                { terms: { 'taxonomyValues.severity': [] } },
              ],
            },
          },
        ],
      },
    });
  });

  it('applies the same selected-∩-granted rule to project scoping, never trusting filters.projectIds alone', () => {
    const filters = mkFilters({ projectIds: ['proj-1', 'proj-2', 'proj-forged'] });
    const grants = mkGrants({ projectIds: ['proj-1', 'proj-2', 'proj-3'] });

    const query = buildArticleSearchQuery(filters, grants);
    const projectFilter = findFilterContaining(query, 'projectId');

    expect(projectFilter).toEqual({ terms: { projectId: ['proj-1', 'proj-2'] } });
  });

  it('falls back to the group\'s full granted project set when the caller selects none', () => {
    const filters = mkFilters({ projectIds: [] });
    const grants = mkGrants({ projectIds: ['proj-1', 'proj-2'] });

    const query = buildArticleSearchQuery(filters, grants);
    const projectFilter = findFilterContaining(query, 'projectId');

    expect(projectFilter).toEqual({ terms: { projectId: ['proj-1', 'proj-2'] } });
  });

  it('does not restrict soft (ungoverned) taxonomy concepts by any grant, only by the raw selection', () => {
    const filters = mkFilters({ taxonomyValues: { region: ['east', 'west'] } });
    const grants = mkGrants({ hardFilterGrants: [], softFilterConceptKeys: ['region'] });

    const query = buildArticleSearchQuery(filters, grants);
    const regionFilter = findFilterContaining(query, 'taxonomyValues.region');

    expect(regionFilter).toEqual({ terms: { 'taxonomyValues.region': ['east', 'west'] } });
  });

  it('ANDs across different taxonomy concepts while ORing within one concept', () => {
    const filters = mkFilters({
      taxonomyValues: { severity: ['critical', 'high'], region: ['east'] },
    });
    const grants = mkGrants({
      hardFilterGrants: [
        { conceptId: 'c1' as never, conceptKey: 'severity', conceptName: 'Severity', allowedValues: ['critical', 'high'], projectId: 'proj-1' },
      ],
    });

    const query = buildArticleSearchQuery(filters, grants);
    const filter = getFilterArray(query);

    expect(filter).toContainEqual({ terms: { 'taxonomyValues.region': ['east'] } });
    // The hard concept is now wrapped in a per-project should/must clause (see the
    // "multi-project hard-filter grants" describe block below) rather than a bare terms
    // filter — assert on its content via JSON containment instead of toContainEqual.
    expect(JSON.stringify(filter)).toContain('"taxonomyValues.severity":["critical","high"]');
  });

  it('maps hiddenArticles mode to the hidden boolean filter', () => {
    const excludeQuery = buildArticleSearchQuery(mkFilters({ hiddenArticles: 'exclude' }), mkGrants());
    expect(findFilterContaining(excludeQuery, '"hidden"')).toEqual({ term: { hidden: false } });

    const onlyHiddenQuery = buildArticleSearchQuery(mkFilters({ hiddenArticles: 'onlyHidden' }), mkGrants());
    expect(findFilterContaining(onlyHiddenQuery, '"hidden"')).toEqual({ term: { hidden: true } });
  });

  it('maps sourceTypeTab to a sourceType term filter, or omits it for "all"', () => {
    const newsQuery = buildArticleSearchQuery(mkFilters({ sourceTypeTab: 'news' }), mkGrants());
    expect(findFilterContaining(newsQuery, 'sourceType')).toEqual({ term: { sourceType: 'news' } });

    const docsQuery = buildArticleSearchQuery(mkFilters({ sourceTypeTab: 'documents' }), mkGrants());
    expect(findFilterContaining(docsQuery, 'sourceType')).toEqual({ term: { sourceType: 'file_system' } });

    const allQuery = buildArticleSearchQuery(mkFilters({ sourceTypeTab: 'all' }), mkGrants());
    expect(findFilterContaining(allQuery, 'sourceType')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Regression coverage for a real bug found while seeding a live demo dataset: a group
// granted MULTIPLE projects, each with its own hard-placement concept (very often sharing
// the same key, e.g. every project defining its own "Website Domain/Source" concept),
// previously had every one of those grants flatly AND'd together regardless of which
// project a given document actually belonged to — silently excluding legitimate matches
// (or, when keys differed per project, excluding EVERY document, since no article carries
// every other granted project's own concept field). Each hard-filter grant must only ever
// constrain documents in ITS OWN project.
// ---------------------------------------------------------------------------
describe('buildArticleSearchQuery — hard filter concepts across multiple granted projects', () => {
  it("scopes each project's hard-filter grant to documents in that project only, even when the concept key is shared", () => {
    const filters = mkFilters({ projectIds: ['proj-1', 'proj-2'] });
    const grants = mkGrants({
      projectIds: ['proj-1', 'proj-2'],
      hardFilterGrants: [
        { conceptId: 'c1' as never, conceptKey: 'source', conceptName: 'Source', allowedValues: ['wire-a'], projectId: 'proj-1' },
        { conceptId: 'c2' as never, conceptKey: 'source', conceptName: 'Source', allowedValues: ['wire-b'], projectId: 'proj-2' },
      ],
    });

    const query = buildArticleSearchQuery(filters, grants);
    const hardFilterClause = findFilterContaining(query, 'taxonomyValues.source');

    // NOT a single flat `{ terms: { 'taxonomyValues.source': ['wire-a'] } }` (which would
    // wrongly exclude every proj-2 document) — each project's own allowed set applies only
    // within that project's own branch.
    expect(hardFilterClause).toEqual({
      bool: {
        should: [
          { bool: { must: [{ term: { projectId: 'proj-1' } }, { terms: { 'taxonomyValues.source': ['wire-a'] } }] } },
          { bool: { must: [{ term: { projectId: 'proj-2' } }, { terms: { 'taxonomyValues.source': ['wire-b'] } }] } },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it("does not require a project with no hard-placement concept to also satisfy another project's grant", () => {
    const filters = mkFilters({ projectIds: ['proj-1', 'proj-2'] });
    const grants = mkGrants({
      projectIds: ['proj-1', 'proj-2'],
      hardFilterGrants: [
        { conceptId: 'c1' as never, conceptKey: 'source', conceptName: 'Source', allowedValues: ['wire-a'], projectId: 'proj-1' },
      ],
    });

    const query = buildArticleSearchQuery(filters, grants);
    const hardFilterClause = findFilterContaining(query, 'taxonomyValues.source');

    expect(hardFilterClause).toEqual({
      bool: {
        should: [
          { bool: { must: [{ term: { projectId: 'proj-1' } }, { terms: { 'taxonomyValues.source': ['wire-a'] } }] } },
          { term: { projectId: 'proj-2' } },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it('only builds a should-branch for projects actually in the effective (selected ∩ granted) project set', () => {
    const filters = mkFilters({ projectIds: ['proj-1'] }); // user/search narrows to just proj-1
    const grants = mkGrants({
      projectIds: ['proj-1', 'proj-2'],
      hardFilterGrants: [
        { conceptId: 'c1' as never, conceptKey: 'source', conceptName: 'Source', allowedValues: ['wire-a'], projectId: 'proj-1' },
        { conceptId: 'c2' as never, conceptKey: 'source', conceptName: 'Source', allowedValues: ['wire-b'], projectId: 'proj-2' },
      ],
    });

    const query = buildArticleSearchQuery(filters, grants);
    const hardFilterClause = findFilterContaining(query, 'taxonomyValues.source');

    expect(hardFilterClause).toEqual({
      bool: {
        should: [
          { bool: { must: [{ term: { projectId: 'proj-1' } }, { terms: { 'taxonomyValues.source': ['wire-a'] } }] } },
        ],
        minimum_should_match: 1,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Date filter — "now" resolved at query time, never at save time
// ---------------------------------------------------------------------------

describe('buildDateRangeFilter — rolling "now at query time" semantics', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');

  it('computes lastNDays relative to the injected "now", not the real wall clock', () => {
    const filter = buildDateRangeFilter({ mode: 'lastNDays', lastNDays: 7 }, now);
    const expectedStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    expect(filter).toEqual({ range: { publishedAt: { gte: expectedStart, lte: now.toISOString() } } });
  });

  it('produces a different window as "now" advances — proves the window is never resolved once and cached', () => {
    const laterNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const filterAtNow = buildDateRangeFilter({ mode: 'lastNDays', lastNDays: 7 }, now);
    const filterAtLaterNow = buildDateRangeFilter({ mode: 'lastNDays', lastNDays: 7 }, laterNow);

    expect(filterAtNow).not.toEqual(filterAtLaterNow);
  });

  it('"between" mode uses the explicit start/end verbatim, ignoring "now"', () => {
    const filter = buildDateRangeFilter(
      { mode: 'between', start: '2026-01-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' },
      now,
    );
    expect(filter).toEqual({
      range: { publishedAt: { gte: '2026-01-01T00:00:00.000Z', lte: '2026-02-01T00:00:00.000Z' } },
    });
  });

  it('"untilNow" mode uses the injected "now" as the upper bound', () => {
    const filter = buildDateRangeFilter({ mode: 'untilNow', start: '2026-01-01T00:00:00.000Z' }, now);
    expect(filter).toEqual({
      range: { publishedAt: { gte: '2026-01-01T00:00:00.000Z', lte: now.toISOString() } },
    });
  });

  it('returns null for an absent or incomplete date filter', () => {
    expect(buildDateRangeFilter(null, now)).toBeNull();
    expect(buildDateRangeFilter({ mode: 'lastNDays', lastNDays: null }, now)).toBeNull();
    expect(buildDateRangeFilter({ mode: 'between' }, now)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Advanced Search — per-group / per-condition operator chaining
// ---------------------------------------------------------------------------

function textCondition(id: string, value: string, operatorToNext: BooleanOperator): AdvancedSearchCondition {
  return { id, mode: 'text', values: [value], matchLogic: 'any', operatorToNext };
}

function textClause(value: string): Record<string, unknown> {
  return {
    bool: {
      should: [{ multi_match: { query: value, fields: TEXT_SEARCH_FIELDS, type: 'best_fields' } }],
      minimum_should_match: 1,
    },
  };
}

describe('buildAdvancedSearchQuery — AND/OR chaining', () => {
  it('folds three groups left-to-right using each group\'s OWN operatorToNext, not a flat must/should', () => {
    const groups: AdvancedSearchGroup[] = [
      { id: 'g1', operatorToNext: 'AND', conditions: [textCondition('c1', 'alpha', 'AND')] },
      { id: 'g2', operatorToNext: 'OR', conditions: [textCondition('c2', 'beta', 'AND')] },
      { id: 'g3', operatorToNext: 'AND', conditions: [textCondition('c3', 'gamma', 'AND')] },
    ];
    const advancedSearch: AdvancedSearch = { enabled: true, groups };

    const result = buildAdvancedSearchQuery(advancedSearch);

    // (g1 AND g2) OR g3 — never {must:[g1,g2,g3]} or {should:[g1,g2,g3]}.
    expect(result).toEqual({
      bool: {
        should: [{ bool: { must: [textClause('alpha'), textClause('beta')] } }, textClause('gamma')],
        minimum_should_match: 1,
      },
    });
  });

  it('folds a group\'s conditions using each condition\'s OWN operatorToNext, the same pattern one level down', () => {
    const conditions: AdvancedSearchCondition[] = [
      textCondition('c1', 'alpha', 'OR'),
      textCondition('c2', 'beta', 'AND'),
      textCondition('c3', 'gamma', 'AND'),
    ];
    const advancedSearch: AdvancedSearch = {
      enabled: true,
      groups: [{ id: 'g1', operatorToNext: 'AND', conditions }],
    };

    const result = buildAdvancedSearchQuery(advancedSearch);

    // (alpha OR beta) AND gamma
    expect(result).toEqual({
      bool: {
        must: [
          { bool: { should: [textClause('alpha'), textClause('beta')], minimum_should_match: 1 } },
          textClause('gamma'),
        ],
      },
    });
  });

  it('returns null when Advanced Search is disabled or has no groups', () => {
    expect(buildAdvancedSearchQuery({ enabled: false, groups: [{ id: 'g1', operatorToNext: 'AND', conditions: [textCondition('c1', 'x', 'AND')] }] })).toBeNull();
    expect(buildAdvancedSearchQuery({ enabled: true, groups: [] })).toBeNull();
  });

  it('matchLogic "all" requires every value to match as a bool must of phrase clauses', () => {
    const advancedSearch: AdvancedSearch = {
      enabled: true,
      groups: [
        {
          id: 'g1',
          operatorToNext: 'AND',
          conditions: [{ id: 'c1', mode: 'text', values: ['alpha', 'beta'], matchLogic: 'all', operatorToNext: 'AND' }],
        },
      ],
    };
    const result = buildAdvancedSearchQuery(advancedSearch);
    expect(result).toEqual({
      bool: {
        must: [
          { multi_match: { query: 'alpha', fields: TEXT_SEARCH_FIELDS, type: 'phrase' } },
          { multi_match: { query: 'beta', fields: TEXT_SEARCH_FIELDS, type: 'phrase' } },
        ],
      },
    });
  });

  it('matchLogic "none" excludes articles matching any of the values', () => {
    const advancedSearch: AdvancedSearch = {
      enabled: true,
      groups: [
        {
          id: 'g1',
          operatorToNext: 'AND',
          conditions: [
            { id: 'c1', mode: 'taxonomy', conceptKey: 'region', values: ['east', 'west'], matchLogic: 'none', operatorToNext: 'AND' },
          ],
        },
      ],
    };
    const result = buildAdvancedSearchQuery(advancedSearch);
    expect(result).toEqual({
      bool: {
        must_not: [{ match: { 'taxonomyValues.region': 'east' } }, { match: { 'taxonomyValues.region': 'west' } }],
      },
    });
  });

  it('mode "crossConcept" ORs across all listed conceptKeys for each value', () => {
    const advancedSearch: AdvancedSearch = {
      enabled: true,
      groups: [
        {
          id: 'g1',
          operatorToNext: 'AND',
          conditions: [
            {
              id: 'c1',
              mode: 'crossConcept',
              conceptKeys: ['region', 'market'],
              values: ['east'],
              matchLogic: 'exact',
              operatorToNext: 'AND',
            },
          ],
        },
      ],
    };
    const result = buildAdvancedSearchQuery(advancedSearch);
    expect(result).toEqual({
      bool: {
        should: [
          {
            bool: {
              should: [
                { match_phrase: { 'taxonomyValues.region': 'east' } },
                { match_phrase: { 'taxonomyValues.market': 'east' } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it('treats an in-progress condition with no values yet as a no-op match_all, not zero results', () => {
    const advancedSearch: AdvancedSearch = {
      enabled: true,
      groups: [
        { id: 'g1', operatorToNext: 'AND', conditions: [{ id: 'c1', mode: 'text', values: [], matchLogic: 'any', operatorToNext: 'AND' }] },
      ],
    };
    expect(buildAdvancedSearchQuery(advancedSearch)).toEqual({ match_all: {} });
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('buildArticleSearchRequestBody', () => {
  it('turns caller-supplied page/size into a raw ES from/size, never hardcoding a page size', () => {
    const body = buildArticleSearchRequestBody({ filters: mkFilters(), grants: mkGrants(), page: 3, size: 12 });
    expect(body.from).toBe(24);
    expect(body.size).toBe(12);
  });

  it('sorts by title.keyword for title_asc/title_desc and by publishedAt for date sorts', () => {
    const titleAsc = buildArticleSearchRequestBody({ filters: mkFilters({ sort: 'title_asc' }), grants: mkGrants(), page: 1, size: 50 });
    expect(titleAsc.sort).toEqual([{ 'title.keyword': 'asc' }]);

    const dateDesc = buildArticleSearchRequestBody({ filters: mkFilters({ sort: 'date_desc' }), grants: mkGrants(), page: 1, size: 50 });
    expect(dateDesc.sort).toEqual([{ publishedAt: 'desc' }]);
  });
});

// ---------------------------------------------------------------------------
// Facets
// ---------------------------------------------------------------------------

describe('sortFacetBuckets', () => {
  const buckets = [
    { key: 'b', count: 2 },
    { key: 'a', count: 5 },
    { key: 'c', count: 1 },
  ];

  it('sorts az/za alphabetically by key', () => {
    expect(sortFacetBuckets(buckets, 'az').map((b) => b.key)).toEqual(['a', 'b', 'c']);
    expect(sortFacetBuckets(buckets, 'za').map((b) => b.key)).toEqual(['c', 'b', 'a']);
  });

  it('sorts countAsc/countDesc by count', () => {
    expect(sortFacetBuckets(buckets, 'countAsc').map((b) => b.count)).toEqual([1, 2, 5]);
    expect(sortFacetBuckets(buckets, 'countDesc').map((b) => b.count)).toEqual([5, 2, 1]);
  });

  it('does not mutate the input array', () => {
    const original = [...buckets];
    sortFacetBuckets(buckets, 'az');
    expect(buckets).toEqual(original);
  });
});

describe('filterFacetBuckets', () => {
  it('drops any bucket outside the granted allowedValues, even if ES had returned it', () => {
    const buckets = [
      { key: 'critical', count: 5 },
      { key: 'leaked-ungranted-value', count: 2 },
    ];
    expect(filterFacetBuckets(buckets, { allowedValues: ['critical', 'high'] })).toEqual([
      { key: 'critical', count: 5 },
    ]);
  });

  it('excludes zero-count buckets only when asked to', () => {
    const buckets = [
      { key: 'a', count: 0 },
      { key: 'b', count: 3 },
    ];
    expect(filterFacetBuckets(buckets, { excludeZeroCounts: true })).toEqual([{ key: 'b', count: 3 }]);
    expect(filterFacetBuckets(buckets, { excludeZeroCounts: false })).toEqual(buckets);
  });
});

describe('buildArticleFacetsRequestBody', () => {
  it('excludes a concept\'s own selected filter from its own facet aggregation but keeps it in the others\'', () => {
    const filters = mkFilters({ taxonomyValues: { region: ['east'], market: ['us'] } });
    const grants = mkGrants({ softFilterConceptKeys: ['region', 'market'] });

    const body = buildArticleFacetsRequestBody({ filters, grants, conceptKeys: ['region', 'market'], sort: 'az' });
    const aggs = body.aggs as Record<string, { filter: Record<string, unknown> }>;

    const regionFilterJson = JSON.stringify(aggs.region.filter);
    const marketFilterJson = JSON.stringify(aggs.market.filter);

    expect(regionFilterJson).not.toContain('taxonomyValues.region');
    expect(regionFilterJson).toContain('taxonomyValues.market');
    expect(marketFilterJson).not.toContain('taxonomyValues.market');
    expect(marketFilterJson).toContain('taxonomyValues.region');
  });

  it('bounds a hard concept\'s terms agg to its granted allowedValues', () => {
    const grants = mkGrants({
      hardFilterGrants: [
        { conceptId: 'c1' as never, conceptKey: 'severity', conceptName: 'Severity', allowedValues: ['critical', 'high'], projectId: 'proj-1' },
      ],
    });
    const body = buildArticleFacetsRequestBody({ filters: mkFilters(), grants, conceptKeys: ['severity'], sort: 'countDesc' });
    const aggs = body.aggs as Record<string, { aggs: { values: { terms: Record<string, unknown> } } }>;

    expect(aggs.severity.aggs.values.terms.include).toEqual(['critical', 'high']);
    expect(aggs.severity.aggs.values.terms.min_doc_count).toBe(0);
  });

  it('uses a never-matching include sentinel (not an unbounded field) when the group has no grant row', () => {
    const grants = mkGrants({
      hardFilterGrants: [
        { conceptId: 'c1' as never, conceptKey: 'severity', conceptName: 'Severity', allowedValues: [], projectId: 'proj-1' },
      ],
    });
    const body = buildArticleFacetsRequestBody({ filters: mkFilters(), grants, conceptKeys: ['severity'], sort: 'countDesc' });
    const aggs = body.aggs as Record<string, { aggs: { values: { terms: { include: string[] } } } }>;

    expect(aggs.severity.aggs.values.terms.include).toHaveLength(1);
    expect(aggs.severity.aggs.values.terms.include[0]).not.toBe('critical');
  });

  it('always includes a "total" sibling aggregation built from the full, unexcluded query', () => {
    const body = buildArticleFacetsRequestBody({ filters: mkFilters(), grants: mkGrants(), conceptKeys: [], sort: 'az' });
    const aggs = body.aggs as Record<string, unknown>;
    expect(aggs.total).toBeDefined();
  });

  it('aggregates userTags independently of the currently selected userTagIds filter', () => {
    const filters = mkFilters({ userTagIds: ['tag-1'], taxonomyValues: { region: ['east'] } });
    const body = buildArticleFacetsRequestBody({
      filters,
      grants: mkGrants({ softFilterConceptKeys: ['region'] }),
      conceptKeys: ['region'],
      sort: 'az',
    });
    const aggs = body.aggs as Record<string, { filter: Record<string, unknown> }>;

    const userTagsFilterJson = JSON.stringify(aggs.userTags.filter);
    const regionFilterJson = JSON.stringify(aggs.region.filter);

    expect(userTagsFilterJson).not.toContain('"tagIds"');
    expect(userTagsFilterJson).toContain('taxonomyValues.region');
    expect(regionFilterJson).toContain('"tagIds"');
  });
});
