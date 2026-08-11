// mongoose 9 renamed the pre-9 `FilterQuery<T>` type to `QueryFilter<T>` (see
// node_modules/mongoose/types/query.d.ts) — this codebase is on mongoose 9.
import type { QueryFilter } from 'mongoose';

import {
  DEFAULT_MAX_SNAPSHOT_ARTICLES,
  asArticleId,
  asGroupId,
  asOrgId,
  asProjectId,
  asSavedSearchId,
  asUserId,
  type AdvancedConditionMode,
  type AdvancedSearch,
  type AdvancedSearchCondition,
  type AdvancedSearchGroup,
  type Article,
  type BooleanOperator,
  type ChannelViewerState,
  type DateFilterValue,
  type FilterPanelState,
  type Permission,
  type SavedSearch,
  type SavedSearchWithViewerState,
} from '@content-insights/shared';

import { ConflictError, NotFoundError, ValidationError, isDuplicateKeyError } from './errors.js';
import { hasGroupPermission, resolveDocumentScope } from './group-scope.js';
import { hasPermission } from './permissions.js';
import { intersectSelectionWithGrant } from './search.js';
import { ArticleModel, type ArticleDocument, type IArticle } from '../models/article.model.js';
import { ChannelViewModel } from '../models/channelView.model.js';
import { ConceptModel } from '../models/concept.model.js';
import { GlobalSettingsModel } from '../models/globalSettings.model.js';
import { GroupModel } from '../models/group.model.js';
import { GroupDefaultQueryModel } from '../models/groupDefaultQuery.model.js';
import {
  SavedSearchModel,
  type ISavedSearch,
  type SavedSearchDocument,
} from '../models/savedSearch.model.js';
import type { AuthenticatedUser } from '../types/express.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------------------
// Naming — normalizeName mirrors SavedSearchModel's own pre-validate hook exactly. Exposed
// here (not just baked into the model) so a caller can check name availability BEFORE
// attempting a write — e.g. an "is this name available" UX affordance the frontend can hit
// as the user types, without needing to round-trip a failed create/update first.
// ---------------------------------------------------------------------------------------

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().normalize('NFC');
}

// Active saved-search/channel names are unique ACROSS THE ENTIRE APP (see the partial index
// on SavedSearchModel) — deliberately no orgId filter here, matching that index exactly.
export async function isNameAvailable(name: string, excludeId?: string): Promise<boolean> {
  const filter: QueryFilter<ISavedSearch> = { normalizedName: normalizeName(name), isActive: true };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  const existing = await SavedSearchModel.exists(filter);
  return !existing;
}

// The DB's partial unique index is the real, race-proof enforcement — this is only a nicer
// error message on the common (non-racy) path. The actual create/save call is still
// expected to run inside a try/catch that translates a duplicate-key error the same way
// (see createSavedSearch/updateSavedSearch below).
async function assertNameAvailable(name: string, excludeId?: string): Promise<void> {
  if (!(await isNameAvailable(name, excludeId))) {
    throw new ConflictError('A saved search with this name already exists', 'SAVED_SEARCH_NAME_TAKEN');
  }
}

function toNameConflictError(err: unknown): never {
  throw isDuplicateKeyError(err)
    ? new ConflictError('A saved search with this name already exists', 'SAVED_SEARCH_NAME_TAKEN')
    : (err as Error);
}

// ---------------------------------------------------------------------------------------
// Mongo-native translation of FilterPanelState.
//
// Deliberately NOT sharing lib/search.ts's Elasticsearch query builder: that module talks
// to ES (buildArticleSearchQuery/executeArticleSearch), and wiring a saved search's snapshot
// resolution / dynamic match-count through it would require a fully-assembled
// ArticleSearchGrants (project + hard-filter-concept grants with resolved conceptKeys) —
// machinery no route in this codebase currently builds (search.routes.ts is still on the
// pre-Article/pre-grants design). What IS reused is intersectSelectionWithGrant, the pure
// "selected ∩ granted" rule — identical business logic, no ES dependency — so the hard
// business rule (an ungranted value, or an ungranted concept entirely, can never leak a
// match) stays defined in exactly one place.
//
// This translation is intentionally "good enough to resolve which articles currently
// match" for snapshot capture / cap-checking / dynamic result counts — it does not attempt
// ES's fuzzy/phrase-prefix text ranking, only exact-ish substring/value matching.
// ---------------------------------------------------------------------------------------

// projectId is carried alongside each hard concept's key/allowedValues so buildArticleMongoQuery
// can scope each grant to documents in its OWN project (see that function's own comment — this
// mirrors lib/search.ts's HardFilterGrantWithKey.projectId and the bug fix it exists for).
interface HardFilterMongoEntry {
  projectId: string;
  key: string;
  allowedValues: string[];
}
interface GroupAccessContext {
  projectIds: string[];
  hardFilterGrants: HardFilterMongoEntry[];
}

async function resolveGroupAccessContext(orgId: string, groupId: string): Promise<GroupAccessContext> {
  const group = await GroupModel.findOne({ _id: groupId, orgId });
  if (!group) {
    throw new NotFoundError('Group not found', 'GROUP_NOT_FOUND');
  }

  const projectIds = group.dataAccess.projectIds.map((id) => id.toString());
  const hardFilterGrants: HardFilterMongoEntry[] = [];
  if (projectIds.length > 0) {
    const hardConcepts = await ConceptModel.find(
      { orgId, projectId: { $in: projectIds }, placement: 'hard' },
      { key: 1, projectId: 1 },
    );
    const grantByConceptId = new Map(
      group.dataAccess.hardFilterGrants.map((grant) => [grant.conceptId.toString(), grant.allowedValues]),
    );
    for (const concept of hardConcepts) {
      hardFilterGrants.push({
        projectId: concept.projectId.toString(),
        key: concept.key,
        allowedValues: grantByConceptId.get(concept._id.toString()) ?? [],
      });
    }
  }

  return { projectIds, hardFilterGrants };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(value: string): RegExp {
  return new RegExp(escapeRegex(value), 'i');
}

function buildDateMongoFilter(
  dateFilter: DateFilterValue | null | undefined,
  now: Date,
): { $gte?: Date; $lte?: Date } | null {
  if (!dateFilter) return null;

  switch (dateFilter.mode) {
    case 'between': {
      if (!dateFilter.start && !dateFilter.end) return null;
      const range: { $gte?: Date; $lte?: Date } = {};
      if (dateFilter.start) range.$gte = new Date(dateFilter.start);
      if (dateFilter.end) range.$lte = new Date(dateFilter.end);
      return range;
    }
    case 'untilNow':
      return dateFilter.start ? { $gte: new Date(dateFilter.start), $lte: now } : null;
    case 'lastNDays':
      return dateFilter.lastNDays
        ? { $gte: new Date(now.getTime() - dateFilter.lastNDays * MS_PER_DAY), $lte: now }
        : null;
  }
}

function resolveConditionMongoFields(
  mode: AdvancedConditionMode,
  conceptKey: string | undefined,
  conceptKeys: string[] | undefined,
): string[] {
  switch (mode) {
    case 'text':
      return [];
    case 'taxonomy':
      return conceptKey ? [`taxonomyValues.${conceptKey}`] : [];
    case 'crossConcept':
      return (conceptKeys ?? []).map((key) => `taxonomyValues.${key}`);
  }
}

// One selected value as a Mongo clause. Array-field equality (`{ field: value }`) is
// Mongo's native "array contains this element" test, which is exactly the "OR'd within a
// key" semantics taxonomy/crossConcept conditions need.
function buildMongoValueClause(mode: AdvancedConditionMode, value: string, fields: string[]): Record<string, unknown> {
  if (mode === 'text') {
    const regex = buildRegex(value);
    return { $or: [{ title: regex }, { summary: regex }, { body: regex }] };
  }
  const clauses = fields.map((field) => ({ [field]: value }));
  if (clauses.length === 0) return {};
  return clauses.length === 1 ? clauses[0]! : { $or: clauses };
}

function buildAdvancedConditionMongoClause(condition: AdvancedSearchCondition): Record<string, unknown> {
  const { mode, conceptKey, conceptKeys, values, matchLogic } = condition;
  if (values.length === 0) return {}; // still-being-edited row — never zeroes out the whole match set

  const fields = resolveConditionMongoFields(mode, conceptKey, conceptKeys);
  switch (matchLogic) {
    case 'all':
      return { $and: values.map((v) => buildMongoValueClause(mode, v, fields)) };
    case 'exact':
    case 'any':
      return { $or: values.map((v) => buildMongoValueClause(mode, v, fields)) };
    case 'none':
      return { $nor: values.map((v) => buildMongoValueClause(mode, v, fields)) };
  }
}

// Left-to-right fold, same semantics as lib/search.ts's foldWithOperators: each item's own
// operatorToNext joins it to the NEXT item, so [A -AND-> B -OR-> C] builds ((A AND B) OR C).
function foldWithOperatorsMongo<T>(
  items: T[],
  buildClause: (item: T) => Record<string, unknown>,
  getOperatorToNext: (item: T) => BooleanOperator,
): Record<string, unknown> | null {
  if (items.length === 0) return null;
  let acc = buildClause(items[0] as T);
  for (let i = 1; i < items.length; i++) {
    const operator = getOperatorToNext(items[i - 1] as T);
    const clause = buildClause(items[i] as T);
    acc = operator === 'AND' ? { $and: [acc, clause] } : { $or: [acc, clause] };
  }
  return acc;
}

function buildAdvancedSearchGroupMongoClause(group: AdvancedSearchGroup): Record<string, unknown> {
  return (
    foldWithOperatorsMongo(group.conditions, buildAdvancedConditionMongoClause, (c) => c.operatorToNext) ?? {}
  );
}

function buildAdvancedSearchMongoClause(advancedSearch: AdvancedSearch): Record<string, unknown> | null {
  if (!advancedSearch.enabled) return null;
  const groups = advancedSearch.groups.filter((g) => g.conditions.length > 0);
  return foldWithOperatorsMongo(groups, buildAdvancedSearchGroupMongoClause, (g) => g.operatorToNext);
}

// The core matcher. `now` is always an explicit parameter (never `new Date()` baked in
// internally) so a dynamic saved search's relative dates (lastNDays) recalculate fresh
// every time this runs — resolved at QUERY time, never at save time. This is what makes
// loadSavedSearch's "rehydrate filters, relative dates recalculate on load" behavior work:
// the stored FilterPanelState is returned unchanged, and only a later call into this
// function (when the caller actually runs it) resolves lastNDays against the current clock.
export async function buildArticleMongoQuery(
  orgId: string,
  groupId: string,
  filters: FilterPanelState,
  now: Date,
): Promise<QueryFilter<IArticle>> {
  const access = await resolveGroupAccessContext(orgId, groupId);
  const clauses: Record<string, unknown>[] = [];

  // Mongoose's default `minimize` strips a genuinely-empty taxonomyValues: {} at write time
  // (e.g. a saved search with no taxonomy selections at all), so a doc read back from Mongo
  // can have this key missing entirely rather than `{}`. Without the fallback, both usages
  // below throw ("Cannot convert undefined or null to object" / TypeError reading
  // `undefined[...]`), which previously 500'd GET /channels, GET /channels/:id/open, and
  // POST /saved-searches/:id/run for any dynamic saved search saved with an empty taxonomy
  // selection.
  const taxonomyValues = filters.taxonomyValues ?? {};

  // Project scoping — never trust filters.projectIds alone; intersect with what the group
  // is actually granted (empty selection = "all accessible at runtime", per
  // FilterPanelState.projectIds' own doc comment).
  const effectiveProjectIds = intersectSelectionWithGrant(filters.projectIds, access.projectIds);
  clauses.push({ projectId: { $in: effectiveProjectIds } });

  // Hard filter concepts — mandatory, non-bypassable. Mirrors lib/search.ts's
  // buildArticleFilterClauses: a group's hard-filter grants are grouped by the project they
  // belong to and OR'd together, each project's own branch AND-ing just its own hard
  // concept(s) — never a flat AND across every granted project's grants regardless of which
  // project a given document actually belongs to (previously made snapshot/count/channel
  // "new articles" resolution return zero for any multi-project group with hard concepts). A
  // hard concept the group has no grant row for still appears here with allowedValues: [], so
  // intersectSelectionWithGrant yields [] -> `{ $in: [] }` -> zero matches for that project,
  // never "everything."
  const hardKeys = new Set(access.hardFilterGrants.map((g) => g.key));
  const relevantHardGrants = access.hardFilterGrants.filter((g) => effectiveProjectIds.includes(g.projectId));
  if (relevantHardGrants.length > 0) {
    const grantsByProject = new Map<string, HardFilterMongoEntry[]>();
    for (const grant of relevantHardGrants) {
      const list = grantsByProject.get(grant.projectId);
      if (list) list.push(grant);
      else grantsByProject.set(grant.projectId, [grant]);
    }
    const perProjectClauses: Record<string, unknown>[] = effectiveProjectIds.map((projectId) => {
      const projectGrants = grantsByProject.get(projectId) ?? [];
      if (projectGrants.length === 0) return { projectId };
      const branchClauses: Record<string, unknown>[] = [{ projectId }];
      for (const grant of projectGrants) {
        const effective = intersectSelectionWithGrant(taxonomyValues[grant.key], grant.allowedValues);
        branchClauses.push({ [`taxonomyValues.${grant.key}`]: { $in: effective } });
      }
      return { $and: branchClauses };
    });
    clauses.push({ $or: perProjectClauses });
  }
  for (const [key, values] of Object.entries(taxonomyValues)) {
    if (hardKeys.has(key)) continue; // already handled above
    if (values.length > 0) clauses.push({ [`taxonomyValues.${key}`]: { $in: values } });
  }

  clauses.push({ hidden: filters.hiddenArticles === 'onlyHidden' });

  if (filters.sourceTypeTab !== 'all') {
    clauses.push({ sourceType: filters.sourceTypeTab === 'news' ? 'news' : 'file_system' });
  }

  const dateRange = buildDateMongoFilter(filters.dateFilter, now);
  if (dateRange) clauses.push({ publishedAt: dateRange });

  if (filters.userTagIds.length > 0) clauses.push({ tagIds: { $in: filters.userTagIds } });

  const trimmedQuery = filters.query.trim();
  if (trimmedQuery) {
    const regex = buildRegex(trimmedQuery);
    clauses.push({ $or: [{ title: regex }, { summary: regex }, { body: regex }] });
  }

  const advancedClause = buildAdvancedSearchMongoClause(filters.advancedSearch);
  if (advancedClause && Object.keys(advancedClause).length > 0) clauses.push(advancedClause);

  return { orgId, $and: clauses };
}

export async function countMatchingArticles(
  orgId: string,
  groupId: string,
  filters: FilterPanelState,
  now: Date,
): Promise<number> {
  const query = await buildArticleMongoQuery(orgId, groupId, filters, now);
  return ArticleModel.countDocuments(query);
}

export interface MatchingLocationHashesResult {
  hashes: string[];
  total: number;
  missingCount: number;
}

// The "get all matching location hashes" query the snapshot business rule needs — a single
// unpaginated fetch (bounded in practice by maxSnapshotArticles being checked right after)
// rather than paging through executeSearch, since the full match set is exactly what both
// the cap check and the frozen hash list need.
export async function resolveMatchingLocationHashes(
  orgId: string,
  groupId: string,
  filters: FilterPanelState,
  now: Date,
): Promise<MatchingLocationHashesResult> {
  const query = await buildArticleMongoQuery(orgId, groupId, filters, now);
  const articles = await ArticleModel.find(query, { locationHash: 1 }).lean<{ locationHash?: string }[]>();

  const hashes: string[] = [];
  let missingCount = 0;
  for (const article of articles) {
    if (article.locationHash) {
      hashes.push(article.locationHash);
    } else {
      // Shouldn't happen — locationHash is `required: true` on the Article schema — but the
      // brief calls this out explicitly ("missing hashes must block snapshot save with clear
      // UX"), so defend anyway rather than silently dropping the article from the snapshot.
      missingCount++;
    }
  }
  return { hashes, total: articles.length, missingCount };
}

async function getMaxSnapshotArticles(orgId: string): Promise<number> {
  const settings = await GlobalSettingsModel.findOne({ orgId }, { maxSnapshotArticles: 1 });
  return settings?.maxSnapshotArticles ?? DEFAULT_MAX_SNAPSHOT_ARTICLES;
}

// The two snapshot business rules, always enforced together and always BEFORE anything is
// persisted — never truncate, never save partially. Throws ValidationError (400), naming
// the limit/actual count or the missing-hash count, per the brief's "clear UX" requirement.
async function assertSnapshotWithinLimits(orgId: string, resolved: MatchingLocationHashesResult): Promise<void> {
  if (resolved.missingCount > 0) {
    throw new ValidationError(
      `Cannot save snapshot: ${resolved.missingCount} of ${resolved.total} matching article(s) are missing a location hash and cannot be captured`,
      undefined,
      'SNAPSHOT_MISSING_LOCATION_HASH',
    );
  }
  const max = await getMaxSnapshotArticles(orgId);
  if (resolved.total > max) {
    throw new ValidationError(
      `This search matches ${resolved.total} articles, which exceeds the maximum of ${max} articles allowed in a snapshot`,
      undefined,
      'SNAPSHOT_LIMIT_EXCEEDED',
    );
  }
}

// ---------------------------------------------------------------------------------------
// Create / update / load
// ---------------------------------------------------------------------------------------

export interface CreateSavedSearchParams {
  orgId: string;
  groupId: string;
  ownerId: string;
  name: string;
  type: 'dynamic' | 'snapshot';
  filters: FilterPanelState;
}

export async function createSavedSearch(
  params: CreateSavedSearchParams,
  now: Date = new Date(),
): Promise<SavedSearchDocument> {
  const { orgId, groupId, ownerId, name, type, filters } = params;

  // Nicer error before ever touching the DB — the partial unique index (isActive: true) on
  // normalizedName is still the real, race-proof enforcement; see the catch below.
  await assertNameAvailable(name);

  let snapshotLocationHashes: string[] = [];
  if (type === 'snapshot') {
    const resolved = await resolveMatchingLocationHashes(orgId, groupId, filters, now);
    await assertSnapshotWithinLimits(orgId, resolved);
    snapshotLocationHashes = resolved.hashes;
  }

  try {
    return await SavedSearchModel.create({
      orgId,
      groupId,
      ownerId,
      name,
      type,
      filters,
      snapshotLocationHashes,
      isActive: true,
      isChannel: false,
      channelName: null,
      sharedWithGroups: [],
      lastRunAt: null,
      newResultsCount: 0,
    });
  } catch (err) {
    return toNameConflictError(err);
  }
}

export interface UpdateSavedSearchParams {
  name?: string;
  filters?: FilterPanelState;
}

// Rename-only vs. re-snapshot: the canonical updateSavedSearchSchema (packages/shared) has
// no separate "resnapshot" flag, and this file must not invent fields outside that
// contract. So the chosen signal is: for a `type: 'snapshot'` saved search, the update
// payload including `filters` IS the "explicitly re-snapshotting" request (a snapshot's
// filters describe what was captured — changing them only makes sense if the frozen set is
// meant to be recaptured); a rename-only PUT (filters omitted) never touches
// snapshotLocationHashes. Document this choice at the call site (the PUT /:id route) too.
export async function updateSavedSearch(
  doc: SavedSearchDocument,
  now: Date = new Date(),
  params: UpdateSavedSearchParams,
): Promise<SavedSearchDocument> {
  if (params.name !== undefined) {
    await assertNameAvailable(params.name, doc._id.toString());
    doc.name = params.name; // pre-validate hook on save() recomputes normalizedName
  }

  if (params.filters !== undefined) {
    if (doc.type === 'snapshot') {
      const resolved = await resolveMatchingLocationHashes(
        doc.orgId.toString(),
        doc.groupId.toString(),
        params.filters,
        now,
      );
      // Validated BEFORE either field is assigned to the document below — an over-cap or
      // missing-hash re-snapshot must leave the existing snapshot (filters AND
      // snapshotLocationHashes) completely untouched, not partially applied.
      await assertSnapshotWithinLimits(doc.orgId.toString(), resolved);
      doc.snapshotLocationHashes = resolved.hashes;
    }
    doc.filters = params.filters;
  }

  try {
    await doc.save();
  } catch (err) {
    return toNameConflictError(err);
  }
  return doc;
}

export type LoadedSavedSearch =
  | { type: 'dynamic'; filters: FilterPanelState }
  | { type: 'snapshot'; filters: FilterPanelState; locationHashes: string[] };

// "Loading" a dynamic saved search is just handing back its stored FilterPanelState
// unchanged — relative dates (lastNDays) are NOT resolved here, only later at actual
// query/run time (buildArticleMongoQuery's `now` parameter), which is what makes it
// "rolling." A snapshot has no live query at all — its "search" IS its frozen locationHash
// list — see fetchArticlesByLocationHashes for turning that into actual articles.
export function loadSavedSearch(doc: SavedSearchDocument): LoadedSavedSearch {
  if (doc.type === 'snapshot') {
    return { type: 'snapshot', filters: doc.filters, locationHashes: doc.snapshotLocationHashes };
  }
  return { type: 'dynamic', filters: doc.filters };
}

export interface ArticlePage {
  items: Article[];
  total: number;
}

export async function fetchArticlesByLocationHashes(
  orgId: string,
  hashes: string[],
  opts: { page?: number; size?: number } = {},
): Promise<ArticlePage> {
  if (hashes.length === 0) {
    return { items: [], total: 0 };
  }
  const { page = 1, size = hashes.length } = opts;
  const filter = { orgId, locationHash: { $in: hashes } };
  const [docs, total] = await Promise.all([
    ArticleModel.find(filter)
      .sort({ publishedAt: -1 })
      .skip((page - 1) * size)
      .limit(size),
    ArticleModel.countDocuments(filter),
  ]);
  return { items: docs.map(toArticleDTO), total };
}

export interface RunSavedSearchResult {
  hits: Article[];
  total: number;
}

export async function runSavedSearchQuery(
  doc: SavedSearchDocument,
  page: number,
  size: number,
  now: Date = new Date(),
): Promise<RunSavedSearchResult> {
  if (doc.type === 'snapshot') {
    const { items, total } = await fetchArticlesByLocationHashes(doc.orgId.toString(), doc.snapshotLocationHashes, {
      page,
      size,
    });
    return { hits: items, total };
  }

  const query = await buildArticleMongoQuery(doc.orgId.toString(), doc.groupId.toString(), doc.filters, now);
  const [docs, total] = await Promise.all([
    ArticleModel.find(query)
      .sort({ publishedAt: -1 })
      .skip((page - 1) * size)
      .limit(size),
    ArticleModel.countDocuments(query),
  ]);
  return { hits: docs.map(toArticleDTO), total };
}

// "Mark as run" for channel new-articles semantics — sets lastRunAt and refreshes the
// org/global newResultsCount (an absolute "how many match right now" count, not a delta —
// per-viewer "how many are NEW to ME" is ChannelView's job, see resolveChannelViewerState).
// A snapshot's result set is frozen, so nothing is ever "new" for one.
export async function markSavedSearchAsRun(
  doc: SavedSearchDocument,
  now: Date = new Date(),
): Promise<SavedSearchDocument> {
  doc.lastRunAt = now;
  doc.newResultsCount =
    doc.type === 'dynamic' ? await countMatchingArticles(doc.orgId.toString(), doc.groupId.toString(), doc.filters, now) : 0;
  await doc.save();
  return doc;
}

// ---------------------------------------------------------------------------------------
// Visibility resolution
//
// Precedence (highest first):
//   1. Application Admin (or anyone else org-wide-granted saved-searches:manageAll):
//      every saved search in the org.
//   2. User Group Admin (groups:manage, scoped or org-wide): everything created under any
//      group they manage, PLUS their own, PLUS the current group's default.
//   3. Everyone else (Analyst/Read-Only/...): their own, PLUS the current group's default.
//
// "Sharing into a group" (sharedWithGroups) is layered on top of ALL non-admin tiers — see
// its own comment below for why that's the ONLY thing that expands visibility beyond these
// rules (exposing something as a channel never does).
// ---------------------------------------------------------------------------------------

async function getCurrentGroupDefaultSavedSearchIds(orgId: string, groupId: string): Promise<string[]> {
  const docs = await GroupDefaultQueryModel.find({ orgId, groupId }, { savedSearchId: 1 });
  return docs.map((doc) => doc.savedSearchId.toString());
}

// Shared by resolveVisibleSavedSearches and isSavedSearchVisible — "created by users in
// their managed groups" is operationalized via SavedSearch.groupId itself (the navbar
// group active when it was saved — see the model's own comment on that field), not by
// resolving each owner's group membership individually. groups:manage is the permission
// uniquely granted to the System Role named "User Group Admin" (see
// @content-insights/shared's SYSTEM_ROLE_PERMISSIONS) — using the permission (re-resolved
// fresh from live Role/Group data, same as every other group-scoped check in this
// codebase) rather than matching the role by name keeps this consistent with the rest of
// the app's permission-based authorization model.
async function resolveManagedGroupIds(user: AuthenticatedUser): Promise<{ orgWide: boolean; groupIds: string[] }> {
  const scope = await resolveDocumentScope(user, 'groups:manage' satisfies Permission);
  return scope.orgWide ? { orgWide: true, groupIds: [] } : { orgWide: false, groupIds: scope.allowedGroupIds };
}

// `groupId` is the caller's CURRENT navbar group (nullable — some callers, e.g. a
// cross-group "all mine" listing, may not have one in context). Returns a filter that
// already includes orgId; callers add any further filters (isActive, isChannel, ...) of
// their own on top.
//
// SECURITY: `groupId` is caller-supplied (a query param) — it is NEVER trusted outright as
// "a group this user actually operates in." Before it's allowed to widen the result set via
// the group's default query / sharedWithGroups, the caller must actually hold
// 'saved-searches:read' there (org-wide or scoped) — otherwise a user could probe an
// arbitrary group id they have no relationship to and learn what's been shared into it.
export async function resolveVisibleSavedSearches(
  user: AuthenticatedUser,
  groupId: string | null,
): Promise<QueryFilter<ISavedSearch>> {
  // Tier 1 — hasPermission checks the JWT-denormalized GLOBAL permission set (see
  // lib/permissions.ts), which is exactly right here: this tier is specifically about an
  // ORG-WIDE grant, not a group-scoped one.
  if (hasPermission(user, 'saved-searches:manageAll' satisfies Permission)) {
    return { orgId: user.orgId };
  }

  const orConditions: Record<string, unknown>[] = [{ ownerId: user.id }];

  if (groupId && (await hasGroupPermission(user, 'saved-searches:read' satisfies Permission, groupId))) {
    const defaultIds = await getCurrentGroupDefaultSavedSearchIds(user.orgId, groupId);
    if (defaultIds.length > 0) {
      orConditions.push({ _id: { $in: defaultIds } });
    }
    // The ONLY visibility-expanding action beyond ownership/admin tiers/the group's
    // default — see POST /:id/share's own comment in savedSearch.routes.ts. Exposing a
    // saved search as a channel (isChannel: true) never by itself grants anyone new
    // visibility into it.
    orConditions.push({ 'sharedWithGroups.groupId': groupId });
  }

  // Tier 2 — see resolveManagedGroupIds's own comment above.
  const managed = await resolveManagedGroupIds(user);
  if (managed.orgWide) {
    const allGroups = await GroupModel.find({ orgId: user.orgId }, { _id: 1 });
    if (allGroups.length > 0) {
      orConditions.push({ groupId: { $in: allGroups.map((g) => g._id.toString()) } });
    }
  } else if (managed.groupIds.length > 0) {
    orConditions.push({ groupId: { $in: managed.groupIds } });
  }

  return { orgId: user.orgId, $or: orConditions };
}

// The single-resource counterpart to resolveVisibleSavedSearches — used for GET/PUT/DELETE
// /:id and friends, where there is no single "current navbar group" in play (unlike the
// list endpoints). Deliberately NOT implemented as
// "resolveVisibleSavedSearches(user, doc.groupId) + exists check": that would only ever
// check sharedWithGroups/the default-query against the search's OWN creation group, which
// is wrong whenever it's been shared into a DIFFERENT group — this checks every group it's
// actually been shared into (and every group any of its default-query registrations lives
// under) instead.
export async function isSavedSearchVisible(
  user: AuthenticatedUser,
  doc: Pick<ISavedSearch, 'groupId' | 'ownerId' | 'sharedWithGroups'> & { _id: { toString(): string } },
): Promise<boolean> {
  if (hasPermission(user, 'saved-searches:manageAll' satisfies Permission)) return true;
  if (doc.ownerId.toString() === user.id) return true;

  const managed = await resolveManagedGroupIds(user);
  if (managed.orgWide || managed.groupIds.includes(doc.groupId.toString())) return true;

  for (const grant of doc.sharedWithGroups) {
    if (await hasGroupPermission(user, 'saved-searches:read' satisfies Permission, grant.groupId.toString())) {
      return true;
    }
  }

  const defaultQuery = await GroupDefaultQueryModel.findOne({ savedSearchId: doc._id.toString() }, { groupId: 1 });
  if (
    defaultQuery &&
    (await hasGroupPermission(user, 'saved-searches:read' satisfies Permission, defaultQuery.groupId.toString()))
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------------------

// hasNewArticles for a dynamic channel: true if any article MATCHING the channel's own
// filters was created/ingested since the viewer last looked (never-viewed = epoch, i.e.
// "new" if anything matches at all). A snapshot channel is a frozen result set — there is
// no "new" concept for it, so hasNewArticles is always false, by design (see the brief).
export async function resolveChannelViewerState(
  doc: Pick<ISavedSearch, 'orgId' | 'groupId' | 'type' | 'filters'> & { _id: { toString(): string } },
  userId: string,
  now: Date = new Date(),
): Promise<ChannelViewerState> {
  const view = await ChannelViewModel.findOne({ savedSearchId: doc._id.toString(), userId });
  const lastViewedAt = view?.lastViewedAt ?? null;

  if (doc.type === 'snapshot') {
    return { lastViewedAt: lastViewedAt ? lastViewedAt.toISOString() : null, hasNewArticles: false };
  }

  const since = lastViewedAt ?? new Date(0);
  const baseQuery = await buildArticleMongoQuery(doc.orgId.toString(), doc.groupId.toString(), doc.filters, now);
  const hasNewArticles = Boolean(
    await ArticleModel.exists({
      $and: [baseQuery, { $or: [{ createdAt: { $gt: since } }, { ingestedAt: { $gt: since } }] }],
    }),
  );
  return { lastViewedAt: lastViewedAt ? lastViewedAt.toISOString() : null, hasNewArticles };
}

export type OpenedChannel =
  | { type: 'dynamic'; filters: FilterPanelState; total: number }
  | { type: 'snapshot'; filters: FilterPanelState; articles: Article[]; total: number };

// The "open channel" action — upserts this viewer's ChannelView (clearing their "new"
// badge) and hands back whatever the channel actually IS: filters to run (dynamic) or the
// frozen locationHash-based article set (snapshot).
export async function openChannel(
  doc: SavedSearchDocument,
  userId: string,
  now: Date = new Date(),
): Promise<OpenedChannel> {
  let result: OpenedChannel;
  let lastSeenResultCount: number;

  if (doc.type === 'snapshot') {
    const { items, total } = await fetchArticlesByLocationHashes(doc.orgId.toString(), doc.snapshotLocationHashes);
    result = { type: 'snapshot', filters: doc.filters, articles: items, total };
    lastSeenResultCount = total;
  } else {
    const total = await countMatchingArticles(doc.orgId.toString(), doc.groupId.toString(), doc.filters, now);
    result = { type: 'dynamic', filters: doc.filters, total };
    lastSeenResultCount = total;
  }

  await ChannelViewModel.findOneAndUpdate(
    { savedSearchId: doc._id, userId },
    { $set: { lastViewedAt: now, lastSeenResultCount } },
    { upsert: true, setDefaultsOnInsert: true },
  );

  return result;
}

// ---------------------------------------------------------------------------------------
// DTO mapping — kept local to this feature (not lib/serializers.ts) since that file's
// existing toSavedSearchDTO/toDashboardWidgetDTO still target the pre-Article,
// pre-`filters` SavedSearchParams shape (ISavedSearchParams no longer even exists on the
// current savedSearch.model.ts) — out of scope for this file to fix, and this feature's DTO
// needs (sharedWithGroups group-name resolution, viewer state) are specific to it anyway.
// ---------------------------------------------------------------------------------------

export interface PopulatedOwner {
  _id: { toString(): string };
  email: string;
}

export type PopulatedSavedSearchDoc = Omit<SavedSearchDocument, 'ownerId'> & { ownerId: PopulatedOwner };

export const OWNER_POPULATE = { path: 'ownerId', select: 'email' } as const;

export async function toSavedSearchDTOs(docs: PopulatedSavedSearchDoc[]): Promise<SavedSearch[]> {
  const groupIds = new Set<string>();
  for (const doc of docs) {
    for (const grant of doc.sharedWithGroups) {
      groupIds.add(grant.groupId.toString());
    }
  }
  const groupNameById = new Map<string, string>();
  if (groupIds.size > 0) {
    const groups = await GroupModel.find({ _id: { $in: Array.from(groupIds) } }, { name: 1 });
    for (const group of groups) {
      groupNameById.set(group._id.toString(), group.name);
    }
  }

  return docs.map((doc) => ({
    id: asSavedSearchId(doc._id.toString()),
    orgId: asOrgId(doc.orgId.toString()),
    groupId: asGroupId(doc.groupId.toString()),
    ownerId: asUserId(doc.ownerId._id.toString()),
    ownerEmail: doc.ownerId.email,
    name: doc.name,
    normalizedName: doc.normalizedName,
    type: doc.type,
    filters: doc.filters,
    snapshotLocationHashes: doc.snapshotLocationHashes,
    isActive: doc.isActive,
    isChannel: doc.isChannel,
    channelName: doc.channelName ?? null,
    sharedWithGroups: doc.sharedWithGroups.map((grant) => ({
      groupId: asGroupId(grant.groupId.toString()),
      groupName: groupNameById.get(grant.groupId.toString()) ?? 'Unknown group',
    })),
    lastRunAt: doc.lastRunAt ? doc.lastRunAt.toISOString() : null,
    newResultsCount: doc.newResultsCount,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }));
}

export async function toSavedSearchDTO(doc: PopulatedSavedSearchDoc): Promise<SavedSearch> {
  const [dto] = await toSavedSearchDTOs([doc]);
  return dto as SavedSearch;
}

export async function toChannelDTOs(
  docs: PopulatedSavedSearchDoc[],
  userId: string,
  now: Date = new Date(),
): Promise<SavedSearchWithViewerState[]> {
  const [dtos, viewerStates] = await Promise.all([
    toSavedSearchDTOs(docs),
    Promise.all(docs.map((doc) => resolveChannelViewerState(doc, userId, now))),
  ]);
  return dtos.map((dto, i) => ({ ...dto, viewerState: viewerStates[i] as ChannelViewerState }));
}

function toArticleDTO(doc: ArticleDocument): Article {
  return {
    id: asArticleId(doc._id.toString()),
    orgId: asOrgId(doc.orgId.toString()),
    projectId: asProjectId(doc.projectId.toString()),
    title: doc.title,
    summary: doc.summary,
    body: doc.body,
    ...(doc.url !== undefined ? { url: doc.url } : {}),
    domain: doc.domain,
    sourceType: doc.sourceType,
    publishedAt: doc.publishedAt.toISOString(),
    authors: doc.authors,
    taxonomyValues: doc.taxonomyValues,
    tagIds: doc.tagIds.map((id) => id.toString()),
    assets: doc.assets.map((asset) => ({
      kind: asset.kind,
      url: asset.url,
      ...(asset.fileSizeBytes !== undefined ? { fileSizeBytes: asset.fileSizeBytes } : {}),
    })),
    locationHash: doc.locationHash,
    hidden: doc.hidden,
    hiddenAt: doc.hiddenAt ? doc.hiddenAt.toISOString() : null,
    hiddenBy: doc.hiddenBy ? asUserId(doc.hiddenBy.toString()) : null,
    ingestedAt: doc.ingestedAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
