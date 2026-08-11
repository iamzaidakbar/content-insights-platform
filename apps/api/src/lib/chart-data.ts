// Chart-data execution for Insights (and, through them, Dashboards). This module owns two
// things lib/search.ts deliberately does not:
//   1. Resolving a Group's live data-access grants into the ArticleSearchGrants shape
//      buildArticleSearchQuery needs (lib/search.ts only consumes already-resolved grants —
//      nothing in that module reads GroupModel/ConceptModel).
//   2. Running an *aggregation-only* ES query (terms / date histogram) for an arbitrary set
//      of AggregationSpecs, the same generic shape POST /api/search/aggregate is documented
//      to use (see aggregation.schema.ts's own comment: "internal endpoint used to fetch
//      chart data for Insights").
//
// Both call straight into buildArticleSearchQuery for the filter/query portion — the
// selected-∩-granted hard-filter enforcement lives in exactly one place (lib/search.ts) and
// is never re-implemented here.
import type {
  AggregateSearchResponse,
  AggregationBucket,
  AggregationResult,
  AggregationSpec,
  FilterPanelState,
  WordCloudConfig,
} from '@content-insights/shared';
import { asConceptId, WORD_CLOUD_MAX_WORDS } from '@content-insights/shared';

import { esClient, getOrgIndexName, type EsArticleDocument } from './elasticsearch.js';
import { buildArticleSearchQuery, type ArticleSearchGrants, type HardFilterGrantWithKey } from './search.js';
import { ConceptModel } from '../models/concept.model.js';
import { GroupModel } from '../models/group.model.js';

// ---------------------------------------------------------------------------
// Grant resolution: Group.dataAccess -> ArticleSearchGrants
// ---------------------------------------------------------------------------

// Resolves a Group's CURRENT data access into the shape buildArticleSearchQuery needs.
// Always called fresh per request (never cached on the Insight/caller) — this is what lets
// GET /api/insights/:id/data reflect the *viewer's* live access rather than whatever the
// insight's creator was granted at save time.
//
// Satisfies buildArticleFilterClauses' exhaustiveness contract: every 'hard'-placement
// Concept in the group's granted projects gets an entry, even ones the group has no
// persisted hardFilterGrants row for (allowedValues: [] — see intersectSelectionWithGrant's
// own comment for why that's what turns "no grant row" into "zero results" instead of
// silently falling through to "no restriction").
export async function resolveGroupArticleSearchGrants(
  orgId: string,
  groupId: string,
): Promise<ArticleSearchGrants> {
  const group = await GroupModel.findOne({ _id: groupId, orgId });
  if (!group) {
    // No such group (wrong org, deleted, or a caller-supplied id that was never valid) —
    // the only safe default is "granted nothing," never "granted everything."
    return { projectIds: [], hardFilterGrants: [], softFilterConceptKeys: [] };
  }

  const projectIds = group.dataAccess.projectIds.map((id) => id.toString());
  const concepts =
    projectIds.length > 0 ? await ConceptModel.find({ orgId, projectId: { $in: projectIds } }) : [];

  const grantRowByConceptId = new Map(
    group.dataAccess.hardFilterGrants.map((grant) => [grant.conceptId.toString(), grant]),
  );

  const hardFilterGrants: HardFilterGrantWithKey[] = concepts
    .filter((concept) => concept.placement === 'hard')
    .map((concept) => {
      const grantRow = grantRowByConceptId.get(concept._id.toString());
      return {
        conceptId: asConceptId(concept._id.toString()),
        conceptName: concept.name,
        allowedValues: grantRow?.allowedValues ?? [],
        ...(grantRow?.denialNote ? { denialNote: grantRow.denialNote } : {}),
        conceptKey: concept.key,
        projectId: concept.projectId.toString(),
      };
    });

  const softFilterConceptKeys = concepts
    .filter((concept) => concept.placement === 'soft')
    .map((concept) => concept.key);

  return { projectIds, hardFilterGrants, softFilterConceptKeys };
}

// ---------------------------------------------------------------------------
// Generic terms / date-histogram aggregation runner
// ---------------------------------------------------------------------------

// Mirrors aggregationSpecSchema's own size cap (packages/shared/src/validators/
// aggregation.schema.ts) — kept as a runtime clamp here too since callers building
// AggregationSpecs internally (e.g. from an Insight's fieldMappings) don't go through that
// zod schema.
const TERMS_AGG_MAX_SIZE = 50;
const DEFAULT_TERMS_AGG_SIZE = 10;

function buildAggClause(spec: AggregationSpec): Record<string, unknown> {
  if (spec.type === 'terms') {
    const size = Math.min(spec.size ?? DEFAULT_TERMS_AGG_SIZE, TERMS_AGG_MAX_SIZE);
    // min_doc_count: 0 is deliberately NOT set here (unlike the facets builder in
    // lib/search.ts) — chart data should only ever surface buckets that actually occur in
    // the filtered result set, not pad in every grantable value.
    return { terms: { field: `taxonomyValues.${spec.conceptKey}`, size } };
  }
  // ES's date_histogram calendar_interval values ('day'|'week'|'month'|'quarter'|'year')
  // are exactly DateHistogramAggregationSpec['interval']'s own union — passed straight
  // through, no translation table needed.
  return {
    date_histogram: {
      field: spec.field,
      calendar_interval: spec.interval,
      format: 'yyyy-MM-dd',
      min_doc_count: 0,
    },
  };
}

export interface ChartAggregationParams {
  orgId: string;
  filters: FilterPanelState;
  grants: ArticleSearchGrants;
  aggregations: AggregationSpec[];
  now?: Date | undefined;
}

interface RawBucketAgg {
  buckets?: Array<{ key: string | number; key_as_string?: string; doc_count: number }>;
}

// Reuses buildArticleSearchQuery (lib/search.ts) for the query/filter portion — the ONLY
// thing added here is the `aggs` clause. Returns the same AggregateSearchResponse shape
// POST /api/search/aggregate is documented to return, so a caller reading chart data never
// needs to know whether it came from that endpoint or straight from this helper.
export async function executeChartAggregation(
  params: ChartAggregationParams,
): Promise<AggregateSearchResponse> {
  const { orgId, filters, grants, aggregations, now } = params;
  const index = getOrgIndexName(orgId);
  const query = buildArticleSearchQuery(filters, grants, now);

  const aggs: Record<string, unknown> = {};
  for (const spec of aggregations) {
    aggs[spec.name] = buildAggClause(spec);
  }

  const response = await esClient.search<EsArticleDocument>({
    index,
    query,
    size: 0,
    track_total_hits: true,
    ...(aggregations.length > 0 ? { aggs } : {}),
  });

  const totalRaw = response.hits.total;
  const total = typeof totalRaw === 'number' ? totalRaw : (totalRaw?.value ?? 0);
  const rawAggs = (response.aggregations ?? {}) as Record<string, RawBucketAgg>;

  const results: AggregationResult[] = aggregations.map((spec) => {
    const raw = rawAggs[spec.name];
    const buckets: AggregationBucket[] = (raw?.buckets ?? []).map((bucket) => ({
      key: spec.type === 'dateHistogram' ? (bucket.key_as_string ?? String(bucket.key)) : String(bucket.key),
      count: bucket.doc_count,
    }));
    return { name: spec.name, buckets };
  });

  return { total, aggregations: results, took: response.took ?? 0 };
}

// ---------------------------------------------------------------------------
// Word cloud: term frequency over title+summary+body, computed in-process
// ---------------------------------------------------------------------------

// title/summary/body are ES `text` fields with only a length-truncated `.keyword` sub-field
// (see elasticsearch.ts's ARTICLE_INDEX_PROPERTIES) — neither supports a `terms` aggregation
// over individual words (that needs fielddata enabled on an analyzed field, which this index
// deliberately doesn't do). So word frequency is computed here instead: fetch the matching
// articles' raw text and tokenize/count in process.
//
// Capped at a fixed number of documents (not "every match") so a broad filter (e.g. no
// query at all) can't turn one chart load into an unbounded full-corpus text scan; the most
// recently published matches are used as the representative sample.
const WORD_CLOUD_SCAN_LIMIT = 500;

// Lowercase alphabetic tokens (apostrophes/hyphens allowed inside a word), length >= 2 —
// deliberately simple; anything smarter (stemming, real NLP tokenization) is out of scope.
const WORD_TOKEN_PATTERN = /[a-z][a-z'-]+/g;

// A small, fixed baseline noise filter — without it, the top of every word cloud would be
// "the/and/of/to/a" regardless of content. This is intentionally NOT configurable (unlike
// config.wordCloud's permanentExclusions/temporaryExclusions, which layer on top of this) —
// it's the same fixed set for every org.
const DEFAULT_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one',
  'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old',
  'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too',
  'use', 'with', 'that', 'this', 'from', 'have', 'will', 'your', 'they', 'been', 'said',
  'each', 'which', 'their', 'time', 'would', 'there', 'could', 'other', 'into', 'more',
  'some', 'than', 'then', 'these', 'also', 'when', 'what', 'were', 'about',
  'after', 'over', 'such', 'only', 'most', 'even', 'like', 'just',
  'so', 'at', 'in', 'on', 'is', 'it', 'of', 'to', 'a', 'an', 'as', 'be', 'by', 'or',
  'we', 'i',
]);

export interface WordFrequencyParams {
  orgId: string;
  filters: FilterPanelState;
  grants: ArticleSearchGrants;
  wordCloud: WordCloudConfig;
  now?: Date | undefined;
}

export interface WordFrequencyResult {
  total: number;
  took: number;
  buckets: AggregationBucket[];
}

export async function computeWordFrequencies(params: WordFrequencyParams): Promise<WordFrequencyResult> {
  const { orgId, filters, grants, wordCloud, now } = params;
  const index = getOrgIndexName(orgId);
  const query = buildArticleSearchQuery(filters, grants, now);

  const response = await esClient.search<EsArticleDocument>({
    index,
    query,
    size: WORD_CLOUD_SCAN_LIMIT,
    _source: ['title', 'summary', 'body'],
    sort: [{ publishedAt: 'desc' }],
    track_total_hits: true,
  });

  const totalRaw = response.hits.total;
  const total = typeof totalRaw === 'number' ? totalRaw : (totalRaw?.value ?? 0);

  const exclusions = new Set(
    [...wordCloud.permanentExclusions, ...wordCloud.temporaryExclusions].map((word) => word.toLowerCase()),
  );

  const counts = new Map<string, number>();
  for (const hit of response.hits.hits) {
    const source = hit._source;
    const text = `${source?.title ?? ''} ${source?.summary ?? ''} ${source?.body ?? ''}`.toLowerCase();
    const tokens = text.match(WORD_TOKEN_PATTERN) ?? [];
    for (const token of tokens) {
      if (DEFAULT_STOPWORDS.has(token) || exclusions.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  // WORD_CLOUD_MAX_WORDS is the hard ceiling regardless of what the insight's own config
  // asks for — config.wordCloud.maxWords is already zod-capped at the same value (see
  // wordCloudConfigSchema), so this Math.min is defense-in-depth, not the primary guard.
  const cap = Math.min(wordCloud.maxWords, WORD_CLOUD_MAX_WORDS);
  const buckets: AggregationBucket[] = Array.from(counts.entries())
    .filter(([, count]) => count >= wordCloud.minOccurrence)
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([key, count]) => ({ key, count }));

  return { total, took: response.took ?? 0, buckets };
}
