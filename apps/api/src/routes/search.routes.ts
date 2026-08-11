import express from 'express';

import {
  DEFAULT_USER_SETTINGS,
  facetsRequestSchema,
  searchRequestSchema,
  type FacetsRequestInput,
  type FacetsResponse,
  type FacetSortOrder,
  type FilterPanelState,
  type Permission,
  type SearchRequestInput,
  type SearchResponse,
} from '@content-insights/shared';

import { resolveArticleSearchGrants } from '../lib/article-access.js';
import { asyncHandler } from '../lib/async-handler.js';
import { audit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { success } from '../lib/response.js';
import { executeArticleFacets, executeArticleSearch } from '../lib/search.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { searchRateLimiter } from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validate.js';
import { UserSettingsModel } from '../models/userSettings.model.js';

export const searchRouter = express.Router();

// The facets endpoint's own FacetSortOrder / hide-zero-count behavior isn't a per-request
// body field (facetsRequestSchema is deliberately just `{ filters }`, matching the
// canonical contract) — it's the caller's own persisted UserSettings.search preference
// (facetSortOrder / hideZeroCountFacets), same values a saved UserSettings row already
// carries for GET /api/settings. Falls back to DEFAULT_USER_SETTINGS for a user who
// hasn't had a UserSettings row seeded yet.
async function resolveFacetPreferences(
  userId: string,
  orgId: string,
): Promise<{ sort: FacetSortOrder; hideZeroCount: boolean }> {
  const settings = await UserSettingsModel.findOne(
    { userId, orgId },
    { facetSortOrder: 1, hideZeroCountFacets: 1 },
  );
  return {
    sort: settings?.facetSortOrder ?? DEFAULT_USER_SETTINGS.facetSortOrder,
    hideZeroCount: settings?.hideZeroCountFacets ?? DEFAULT_USER_SETTINGS.hideZeroCountFacets,
  };
}

// No plain requirePermission gate — resolveArticleSearchGrants IS the complete
// authorization decision here (global articles:read, or the caller's current group
// holding articles:read — see lib/article-access.ts), same reasoning the old
// resolveDocumentScope-based routes used to need a scope resolver instead of a fixed
// flat-array permission check.
searchRouter.post(
  '/',
  authenticate,
  // Runs right after authenticate (before orgContext's DB lookup) since the org-scoped
  // rate-limit key only needs req.user.orgId, already available from the JWT claims.
  searchRateLimiter,
  orgContext,
  validate({ body: searchRequestSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const body = req.body as SearchRequestInput;
    const grants = await resolveArticleSearchGrants(req.user, 'articles:read' satisfies Permission);

    // searchRequestSchema's zod-inferred `filters` and the hand-written FilterPanelState
    // type (lib/search.ts's contract) differ only in how optional nested fields (e.g.
    // DateFilterValue.start) are expressed under exactOptionalPropertyTypes — zod's
    // `.optional()` allows an explicit `undefined` value, the interface only allows
    // omission. Structurally identical at runtime; the cast just bridges that TS nuance.
    const result: SearchResponse = await executeArticleSearch({
      filters: body.filters as FilterPanelState,
      grants,
      page: body.page,
      size: body.size,
      orgId: req.user.orgId,
    });

    // Only audit real keyword searches — empty-query filter browsing would flood the log.
    const trimmedQuery = body.filters.query.trim();
    if (trimmedQuery) {
      audit(req, {
        action: 'search.query',
        entityType: 'search',
        details: { query: trimmedQuery, total: result.total },
      });
    }

    res.status(200).json(success(result));
  }),
);

// Live facet counts for the filter panel — same grants/filter semantics as POST /, but
// returns bucket counts instead of hits so the UI can show "critical (12), high (3), ..."
// that respect every OTHER active filter (see lib/search.ts's buildArticleFacetsRequestBody
// for the per-concept "exclude its own filter" mechanics).
searchRouter.post(
  '/facets',
  authenticate,
  searchRateLimiter,
  orgContext,
  validate({ body: facetsRequestSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const body = req.body as FacetsRequestInput;
    const grants = await resolveArticleSearchGrants(req.user, 'articles:read' satisfies Permission);

    // Every concept key the caller's current group can see for its granted projects —
    // hard concepts (bounded to their own grant) plus soft concepts (unrestricted, panel
    // visibility only) — so one call renders every facet section the Filter Panel shows.
    const conceptKeys = Array.from(
      new Set([
        ...grants.hardFilterGrants.map((grant) => grant.conceptKey),
        ...grants.softFilterConceptKeys,
      ]),
    );
    const { sort, hideZeroCount } = await resolveFacetPreferences(req.user.id, req.user.orgId);

    const result: FacetsResponse = await executeArticleFacets(req.user.orgId, {
      filters: body.filters as FilterPanelState,
      grants,
      conceptKeys,
      sort,
      excludeZeroCounts: hideZeroCount,
    });

    res.status(200).json(success(result));
  }),
);
