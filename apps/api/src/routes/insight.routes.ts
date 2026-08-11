import express from 'express';
import mongoose from 'mongoose';

import {
  createInsightSchema,
  updateInsightSchema,
  type AggregationResult,
  type AggregationSpec,
  type ChartType,
  type CreateInsightInput,
  type FilterPanelState,
  type Insight,
  type InsightConfig,
  type PaginatedResult,
  type Permission,
  type UpdateInsightInput,
  type WordCloudConfig,
} from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import {
  computeWordFrequencies,
  executeChartAggregation,
  resolveGroupArticleSearchGrants,
} from '../lib/chart-data.js';
import { AppError, ConflictError, ForbiddenError, isDuplicateKeyError } from '../lib/errors.js';
import { groupIdFromBody, hasGroupPermission, resolveDocumentScope } from '../lib/group-scope.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { pageQuerySchema, type PageQuery } from '../lib/pagination.js';
import { hasPermission } from '../lib/permissions.js';
import { success } from '../lib/response.js';
import { toInsightDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requireScopedPermission } from '../middleware/requireScopedPermission.js';
import { validate } from '../middleware/validate.js';
import { DashboardModel } from '../models/dashboard.model.js';
import { InsightModel, type InsightDocument } from '../models/insight.model.js';

export const insightRouter = express.Router();

const PAGE_SIZE = 20;
const OWNER_POPULATE = { path: 'ownerId', select: 'email' };

// A single fieldMapping-per-terms-agg is the whole story for every chart type except
// wordCloud (see the aggregations-derivation comment on GET /:id/data below) — 25 buckets
// is a generous default for a single categorical dimension without risking an unbounded
// response for a high-cardinality concept.
const TERMS_AGG_SIZE = 25;
// Mirrors aggregateSearchRequestSchema's own `.max(10)` on `aggregations` — a defensive
// ceiling here too since these AggregationSpecs are built from an Insight's own
// fieldMappings, which isn't itself bounded by that zod schema.
const MAX_AGGREGATIONS = 10;

interface PopulatedOwner {
  _id: mongoose.Types.ObjectId;
  email: string;
}
type PopulatedInsight = Omit<InsightDocument, 'ownerId'> & { ownerId: PopulatedOwner };

function isOwner(insight: Pick<PopulatedInsight, 'ownerId'>, userId: string): boolean {
  return insight.ownerId._id.toString() === userId;
}

// Insights are personal (name is unique per owner — see insight.model.ts), but a Dashboard
// can surface any group member's insight to every other group member with read access, so
// visibility can't be owner-only: the owner, an org:admin, or anyone currently holding
// 'insights:read' on the insight's own group may view it. Mutation (PUT/DELETE) stays
// stricter — see assertInsightManageable below.
async function assertInsightReadable(req: express.Request, insight: PopulatedInsight): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
  }
  if (isOwner(insight, req.user.id) || hasPermission(req.user, 'org:admin' satisfies Permission)) {
    return;
  }
  const allowed = await hasGroupPermission(req.user, 'insights:read' satisfies Permission, insight.groupId.toString());
  if (!allowed) {
    throw new ForbiddenError('Missing required permission: insights:read');
  }
}

// Only the owner (re-verified against their CURRENT insights:manage grant on the group —
// not just historical ownership) or an org:admin may rename/reconfigure/delete an insight.
async function assertInsightManageable(req: express.Request, insight: PopulatedInsight): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
  }
  if (hasPermission(req.user, 'org:admin' satisfies Permission)) {
    return;
  }
  if (!isOwner(insight, req.user.id)) {
    throw new ForbiddenError('Only the owner (or an org admin) can modify this insight');
  }
  const allowed = await hasGroupPermission(req.user, 'insights:manage' satisfies Permission, insight.groupId.toString());
  if (!allowed) {
    throw new ForbiddenError('Missing required permission: insights:manage');
  }
}

insightRouter.post(
  '/',
  authenticate,
  orgContext,
  validate({ body: createInsightSchema }),
  requireScopedPermission('insights:manage' satisfies Permission, groupIdFromBody('groupId')),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const { groupId, projectIds, name, chartType, sourceFilters, config } = req.body as CreateInsightInput;
    if (!mongoose.isValidObjectId(groupId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'groupId must be a valid id');
    }

    try {
      const doc = await InsightModel.create({
        orgId: req.user.orgId,
        ownerId: req.user.id,
        groupId,
        projectIds,
        name,
        chartType,
        sourceFilters,
        config,
      });
      const populated = await doc.populate<{ ownerId: PopulatedOwner }>(OWNER_POPULATE);
      res.status(201).json(success(toInsightDTO(populated)));
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('You already have an insight with this name', 'INSIGHT_NAME_TAKEN');
      }
      throw err;
    }
  }),
);

// "own + org-admin-all": every authenticated user can list the insights they created;
// an org:admin additionally sees every insight in the org (oversight), never the reverse.
insightRouter.get(
  '/',
  authenticate,
  orgContext,
  validate({ query: pageQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const { page = 1 } = req.query as unknown as PageQuery;
    const orgAdmin = hasPermission(req.user, 'org:admin' satisfies Permission);

    if (!orgAdmin) {
      // Coarse feature gate — same "do you hold this capability anywhere, org-wide or via
      // any group" pattern as savedSearch.routes.ts's own "mine" scope: ownership is the
      // real access control on each row, this just confirms the caller could plausibly
      // have created something.
      const scope = await resolveDocumentScope(req.user, 'insights:read' satisfies Permission);
      if (!scope.orgWide && scope.allowedGroupIds.length === 0) {
        throw new ForbiddenError('Missing required permission: insights:read');
      }
    }

    const filter: Record<string, unknown> = orgAdmin
      ? { orgId: req.user.orgId }
      : { orgId: req.user.orgId, ownerId: req.user.id };

    const [docs, total] = await Promise.all([
      InsightModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .populate<{ ownerId: PopulatedOwner }>(OWNER_POPULATE),
      InsightModel.countDocuments(filter),
    ]);

    const result: PaginatedResult<Insight> = {
      items: docs.map((doc) => toInsightDTO(doc)),
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };
    res.status(200).json(success(result));
  }),
);

insightRouter.get(
  '/:id',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Insight not found', 'INSIGHT_NOT_FOUND');
    const doc = await InsightModel.findOne({ _id: id, orgId: req.user.orgId }).populate<{
      ownerId: PopulatedOwner;
    }>(OWNER_POPULATE);
    if (!doc) {
      throw new AppError(404, 'INSIGHT_NOT_FOUND', 'Insight not found');
    }
    await assertInsightReadable(req, doc);
    res.status(200).json(success(toInsightDTO(doc)));
  }),
);

insightRouter.put(
  '/:id',
  authenticate,
  orgContext,
  validate({ body: updateInsightSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Insight not found', 'INSIGHT_NOT_FOUND');
    const existing = await InsightModel.findOne({ _id: id, orgId: req.user.orgId }).populate<{
      ownerId: PopulatedOwner;
    }>(OWNER_POPULATE);
    if (!existing) {
      throw new AppError(404, 'INSIGHT_NOT_FOUND', 'Insight not found');
    }
    await assertInsightManageable(req, existing);

    const body = req.body as UpdateInsightInput;
    // createInsightSchema enforces "no wordCloud config unless chartType is wordCloud" at
    // create time; updateInsightSchema allows partial updates so that invariant has to be
    // re-checked here against the MERGED (existing + incoming) state.
    const effectiveChartType = body.chartType ?? existing.chartType;
    const effectiveWordCloud = body.config ? body.config.wordCloud : existing.config.wordCloud;
    if (effectiveChartType !== 'wordCloud' && effectiveWordCloud) {
      throw new AppError(400, 'VALIDATION_ERROR', 'config.wordCloud is only valid when chartType is wordCloud');
    }

    try {
      const doc = await InsightModel.findOneAndUpdate(
        { _id: id, orgId: req.user.orgId },
        { $set: body },
        { new: true },
      ).populate<{ ownerId: PopulatedOwner }>(OWNER_POPULATE);
      if (!doc) {
        throw new AppError(404, 'INSIGHT_NOT_FOUND', 'Insight not found');
      }
      res.status(200).json(success(toInsightDTO(doc)));
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('You already have an insight with this name', 'INSIGHT_NAME_TAKEN');
      }
      throw err;
    }
  }),
);

insightRouter.delete(
  '/:id',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Insight not found', 'INSIGHT_NOT_FOUND');
    const existing = await InsightModel.findOne({ _id: id, orgId: req.user.orgId }).populate<{
      ownerId: PopulatedOwner;
    }>(OWNER_POPULATE);
    if (!existing) {
      throw new AppError(404, 'INSIGHT_NOT_FOUND', 'Insight not found');
    }
    await assertInsightManageable(req, existing);

    // Block, don't cascade — simpler and safer (per the brief): an insight embedded in a
    // dashboard layout shouldn't silently vanish out from under it.
    const referencedByDashboard = await DashboardModel.exists({ 'insights.insightId': id });
    if (referencedByDashboard) {
      throw new ConflictError(
        'This insight is used by one or more dashboards. Remove it from those dashboards before deleting it.',
        'INSIGHT_IN_USE',
      );
    }

    await InsightModel.deleteOne({ _id: id, orgId: req.user.orgId });
    res.status(200).json(success(null));
  }),
);

// ---------------------------------------------------------------------------
// GET /:id/data
// ---------------------------------------------------------------------------

interface InsightDataResponse {
  insightId: string;
  chartType: ChartType;
  total: number;
  took: number;
  aggregations: AggregationResult[];
}

const DEFAULT_WORD_CLOUD_CONFIG: WordCloudConfig = {
  maxWords: 100,
  minOccurrence: 1,
  permanentExclusions: [],
  temporaryExclusions: [],
};

insightRouter.get(
  '/:id/data',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Insight not found', 'INSIGHT_NOT_FOUND');
    const insight = await InsightModel.findOne({ _id: id, orgId: req.user.orgId }).populate<{
      ownerId: PopulatedOwner;
    }>(OWNER_POPULATE);
    if (!insight) {
      throw new AppError(404, 'INSIGHT_NOT_FOUND', 'Insight not found');
    }
    await assertInsightReadable(req, insight);

    // The caller's CURRENT grants for this group — deliberately NOT resolved against the
    // insight's original creator. A viewer's own access can be narrower (or wider) than the
    // creator's was, and data must always reflect what's true right now.
    const grants = await resolveGroupArticleSearchGrants(req.user.orgId, insight.groupId.toString());
    const filters = insight.sourceFilters as unknown as FilterPanelState;
    const config = insight.config as unknown as InsightConfig;

    if (insight.chartType === 'wordCloud') {
      const wordCloud = config.wordCloud ?? DEFAULT_WORD_CLOUD_CONFIG;
      const { total, took, buckets } = await computeWordFrequencies({
        orgId: req.user.orgId,
        filters,
        grants,
        wordCloud,
      });
      const response: InsightDataResponse = {
        insightId: id,
        chartType: insight.chartType,
        total,
        took,
        aggregations: [{ name: 'words', buckets }],
      };
      res.status(200).json(success(response));
      return;
    }

    // Every other chart type: one terms aggregation per fieldMapping, named after its role
    // (e.g. 'category', 'x', 'y', 'series', 'sourceNode') so the client can address each
    // bucket set by the same role name it configured. ChartFieldMapping only carries
    // role+conceptKey (no date-axis indicator), so a true date-histogram axis for
    // streamChart isn't derivable here without extending that shared contract — out of
    // scope for this endpoint; every mapping becomes a taxonomy terms aggregation.
    const aggregations: AggregationSpec[] = config.fieldMappings.slice(0, MAX_AGGREGATIONS).map((mapping) => ({
      name: mapping.role,
      type: 'terms',
      conceptKey: mapping.conceptKey,
      size: TERMS_AGG_SIZE,
    }));

    const { total, took, aggregations: results } = await executeChartAggregation({
      orgId: req.user.orgId,
      filters,
      grants,
      aggregations,
    });

    const response: InsightDataResponse = {
      insightId: id,
      chartType: insight.chartType,
      total,
      took,
      aggregations: results,
    };
    res.status(200).json(success(response));
  }),
);
