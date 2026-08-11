import { Client, errors } from '@elastic/elasticsearch';

import { logger } from './logger.js';
import { OrganizationModel } from '../models/organization.model.js';

// package.json has no "type" field (CJS) and its exports map points both "require" and
// "import" at the same ./index.js — a plain `module.exports = { Client, errors, ... }`
// built from top-level `const { X } = require(...)` destructures. Same shape as bullmq
// (verified working), not jsonwebtoken's (inline require()-as-object-value, broken) or
// ioredis's (default export, no construct signature, broken) shapes. Verified empirically
// via `node -e "import('@elastic/elasticsearch').then(m => console.log(typeof m.Client,
// typeof m.errors))"` — printed "function object", confirming named imports work.

import { config } from './config.js';

export const esClient = new Client({ node: config.elasticsearchUrl });

// One index per org, one ES doc per Article (no chunking — Article.body is already a
// single extracted-text field by the time it reaches this layer; any chunking needed to
// *produce* that body happens upstream in the ingest worker via lib/chunking.ts).
//
// Renamed from the old `ci_{orgId}_documents` (pre-Article-model) convention now that the
// only entity type left is `Article` and the old separate incidents index is gone
// entirely (incidents were removed from the product).
export function getOrgIndexName(orgId: string): string {
  return `ci_${orgId}_articles`;
}

export interface EsArticleDocument {
  articleId: string;
  orgId: string;
  projectId: string;
  title: string;
  summary: string;
  body: string;
  domain: string;
  sourceType: string; // 'news' | 'file_system' — kept as string in the ES doc shape;
  // legacy 'external' values are normalized to 'file_system' at ingest time (see
  // ARTICLE_SOURCE_TYPES's own note in @content-insights/shared/types/article.ts), so
  // nothing on the query/index side ever needs to special-case it.
  publishedAt: string; // ISO
  authors: string[];
  // Keyed by Concept.key. Mapped via the dynamic_template below so a brand-new
  // admin-created concept key becomes a filterable/facetable keyword field the instant an
  // article carrying it is indexed — no explicit remapping step required.
  taxonomyValues: Record<string, string[]>;
  tagIds: string[];
  locationHash: string;
  hidden: boolean;
  createdAt: string; // ISO — Article.createdAt (Mongo doc timestamp), not ingestedAt
}

// Any field nested under `taxonomyValues.*` becomes a keyword (arrays of keywords are
// natively supported by ES's keyword type — no separate "array" type needed). This is
// what lets Concepts stay admin-creatable at runtime: a new concept key that has never
// been seen before still gets mapped correctly the first time an article carrying it is
// indexed, with zero index downtime and no explicit `putMapping` call.
const ARTICLE_INDEX_DYNAMIC_TEMPLATES = [
  {
    taxonomy_values_as_keyword: {
      path_match: 'taxonomyValues.*',
      mapping: { type: 'keyword' },
    },
  },
] as const;

const ARTICLE_INDEX_PROPERTIES = {
  articleId: { type: 'keyword' },
  orgId: { type: 'keyword' },
  projectId: { type: 'keyword' },
  title: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
  summary: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 2048 } } },
  body: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 2048 } } },
  domain: { type: 'keyword' },
  sourceType: { type: 'keyword' },
  publishedAt: { type: 'date' },
  authors: { type: 'keyword' },
  // Explicit `object` (rather than leaving it fully implicit) so the field always exists
  // even for an org with zero articles yet; the dynamic_templates above govern its
  // children regardless of whether this line is present.
  taxonomyValues: { type: 'object' },
  tagIds: { type: 'keyword' },
  locationHash: { type: 'keyword' },
  hidden: { type: 'boolean' },
  createdAt: { type: 'date' },
} as const;

function isResourceAlreadyExistsError(err: unknown): boolean {
  return (
    err instanceof errors.ResponseError &&
    err.body?.error?.type === 'resource_already_exists_exception'
  );
}

// The ES client's TS overloads for indices.create/putMapping resolve against a large,
// deeply-nested union of mapping-property types that a hand-written `as const` mapping
// object structurally satisfies at runtime but not always at the type level (the same
// friction the query-builder functions below sidestep with `as never`) — cast only the
// mapping payload itself, keeping `index` (and everything else) fully type-checked.

// Called once, right after an org is created. Idempotent.
export async function ensureOrgIndexExists(orgId: string): Promise<void> {
  const index = getOrgIndexName(orgId);
  const exists = await esClient.indices.exists({ index });
  if (exists) return;

  try {
    await esClient.indices.create({
      index,
      mappings: {
        properties: ARTICLE_INDEX_PROPERTIES,
        dynamic_templates: ARTICLE_INDEX_DYNAMIC_TEMPLATES,
      } as never,
    });
  } catch (err) {
    if (!isResourceAlreadyExistsError(err)) throw err; // race: created concurrently
  }
}

// putMapping is additive-only against an EXISTING index (no reindex) — this is what lets
// an org created before a given static field existed pick up it later. Static
// properties aside, dynamic_templates registered via putMapping apply to any
// not-yet-seen field going forward, same as if the index had been created with them.
// Normally the index already exists by the time this runs (ensureOrgIndexExists creates it
// at signup), but that call is best-effort at signup time (e.g. it can fail if
// Elasticsearch was briefly unreachable during registration) — so this defends against a
// missing index by creating it first, rather than assuming putMapping's target exists.
export async function ensureOrgIndexMapping(orgId: string): Promise<void> {
  await ensureOrgIndexExists(orgId);
  const index = getOrgIndexName(orgId);
  await esClient.indices.putMapping({
    index,
    properties: ARTICLE_INDEX_PROPERTIES as never,
    dynamic_templates: ARTICLE_INDEX_DYNAMIC_TEMPLATES as never,
  });
}

// Run once at API boot (see index.ts) so pre-existing orgs' indices — created before this
// field set (or the taxonomyValues dynamic_template) existed — get the new mapping
// without a manual migration step. Cheap at current org counts; if org count grows large
// this should become a real migration runner instead of a boot-time loop.
export async function syncAllOrgIndexMappings(): Promise<void> {
  const orgs = await OrganizationModel.find({}, { _id: 1 });
  await Promise.all(
    orgs.map((org) => {
      const orgId = org._id.toString();
      return ensureOrgIndexMapping(orgId).catch((err: unknown) => {
        logger.error({ err, orgId }, 'Failed to sync Elasticsearch index mapping for org');
      });
    }),
  );
}

// The subset of Article fields the index needs — deliberately named/shaped to match
// @content-insights/shared's Article type exactly (id/orgId/projectId/etc.) rather than
// inventing parallel field names, so callers (ingest workers, in a later phase) can spread
// a fetched/serialized Article straight in.
export interface IndexArticleParams {
  id: string;
  orgId: string;
  projectId: string;
  title: string;
  summary: string;
  body: string;
  domain: string;
  sourceType: string;
  publishedAt: string;
  authors: string[];
  taxonomyValues: Record<string, string[]>;
  tagIds: string[];
  locationHash: string;
  hidden: boolean;
  createdAt: string;
}

function toEsArticleDocument(article: IndexArticleParams): EsArticleDocument {
  return {
    articleId: article.id,
    orgId: article.orgId,
    projectId: article.projectId,
    title: article.title,
    summary: article.summary,
    body: article.body,
    domain: article.domain,
    sourceType: article.sourceType,
    publishedAt: article.publishedAt,
    authors: article.authors,
    taxonomyValues: article.taxonomyValues,
    tagIds: article.tagIds,
    locationHash: article.locationHash,
    hidden: article.hidden,
    createdAt: article.createdAt,
  };
}

// Upserts one Article into its org's index. The ES document _id is the Article's own id,
// so re-ingesting the same article (e.g. after an edit, a re-tag, or a hide/unhide) is a
// natural overwrite, never a duplicate.
export async function indexArticle(article: IndexArticleParams): Promise<void> {
  const index = getOrgIndexName(article.orgId);
  await esClient.index({
    index,
    id: article.id,
    document: toEsArticleDocument(article),
    refresh: 'wait_for',
  });
}

export async function deleteArticleFromIndex(orgId: string, articleId: string): Promise<void> {
  const index = getOrgIndexName(orgId);
  try {
    await esClient.delete({ index, id: articleId, refresh: 'wait_for' });
  } catch (err) {
    // 404 = never indexed (e.g. ES was down at write time) — nothing to delete.
    if (!(err instanceof errors.ResponseError && err.statusCode === 404)) throw err;
  }
}

// Wipes every article of one org from its index — used before a full reindex.
export async function deleteAllArticlesForOrg(orgId: string): Promise<void> {
  const index = getOrgIndexName(orgId);
  await esClient.deleteByQuery({
    index,
    query: { match_all: {} },
    conflicts: 'proceed',
    refresh: true,
  });
}

// Bulk-upserts many articles in one request — the batched counterpart to indexArticle,
// used for a full org reindex (e.g. after a bulk taxonomy backfill) rather than N
// sequential single-document indexes.
export async function bulkIndexArticles(
  orgId: string,
  articles: IndexArticleParams[],
): Promise<void> {
  if (articles.length === 0) return;
  const index = getOrgIndexName(orgId);

  const failures: Array<{ status: number; error: unknown }> = [];
  const stats = await esClient.helpers.bulk<IndexArticleParams>({
    datasource: articles,
    onDocument(article) {
      return [{ index: { _index: index, _id: article.id } }, toEsArticleDocument(article)];
    },
    onDrop(dropped) {
      failures.push({ status: dropped.status, error: dropped.error });
    },
  });

  if (stats.failed > 0) {
    throw new Error(
      `Elasticsearch bulk index failed for ${stats.failed}/${articles.length} article(s) of org ${orgId}: ${JSON.stringify(failures[0])}`,
    );
  }
}

// Delete-then-bulk-index: a reindex may produce fewer articles than a previous pass (e.g.
// a source article was deleted from Mongo), so a plain bulk upsert alone would leave stale
// documents behind. Delete-all-then-index guarantees the index ends up exactly matching
// `articles`, never a superset.
export async function reindexOrgArticles(
  orgId: string,
  articles: IndexArticleParams[],
): Promise<void> {
  await deleteAllArticlesForOrg(orgId);
  await bulkIndexArticles(orgId, articles);
}
