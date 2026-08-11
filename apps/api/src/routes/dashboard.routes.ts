import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import {
  asInsightId,
  createDashboardSchema,
  DASHBOARD_MAX_INSIGHTS,
  dashboardLayoutItemSchema,
  updateDashboardSchema,
  type CreateDashboardInput,
  type Dashboard,
  type DashboardInsightRef,
  type DashboardLayoutItem,
  type PaginatedResult,
  type Permission,
  type UpdateDashboardInput,
} from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ConflictError, ForbiddenError } from '../lib/errors.js';
import { groupIdFromBody, hasGroupPermission, resolveDocumentScope } from '../lib/group-scope.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { hasPermission } from '../lib/permissions.js';
import { success } from '../lib/response.js';
import { toDashboardDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requireScopedPermission } from '../middleware/requireScopedPermission.js';
import { validate } from '../middleware/validate.js';
import { DashboardModel, type DashboardDocument } from '../models/dashboard.model.js';
import { InsightModel, type InsightDocument } from '../models/insight.model.js';

export const dashboardRouter = express.Router();

const PAGE_SIZE = 20;

// Every route below authorizes via resolveDocumentScope/assertGroupPermission/
// requireScopedPermission — never a plain requirePermission — because 'dashboards:read'/
// 'dashboards:manage' are typically held *scoped* to a Group (via GroupMember.roleId), not
// org-wide (only Application Admin holds permissions org-wide by default). A flat
// org-wide-only check would 403 the exact personas — a Group-scoped Analyst or Group Admin —
// this feature is for. Mirrors document.routes.ts/savedSearch.routes.ts's own pattern.
async function assertGroupPermission(
  req: express.Request,
  permissionKey: Permission,
  groupId: string,
): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
  }
  const allowed = await hasGroupPermission(req.user, permissionKey, groupId);
  if (!allowed) {
    throw new ForbiddenError(`Missing required permission: ${permissionKey}`);
  }
}

// Mirrors insight.routes.ts's own assertInsightReadable rule (owner, org:admin, or anyone
// holding insights:read on the insight's group) — duplicated rather than imported since
// route modules don't import each other in this codebase; kept in sync by hand.
async function assertInsightVisible(
  req: express.Request,
  insight: Pick<InsightDocument, 'ownerId' | 'groupId'>,
): Promise<void> {
  if (!req.user) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
  }
  if (insight.ownerId.toString() === req.user.id || hasPermission(req.user, 'org:admin' satisfies Permission)) {
    return;
  }
  const allowed = await hasGroupPermission(req.user, 'insights:read' satisfies Permission, insight.groupId.toString());
  if (!allowed) {
    throw new ForbiddenError('Missing required permission: insights:read');
  }
}

// Resolves+authorizes a candidate insightId list for attaching to a dashboard: every id must
// be a valid, distinct, existing (same-org) Insight the caller can actually see. Used by both
// PUT /:id (bulk insightIds replace) and POST /:id/insights (single add).
async function loadAttachableInsights(
  req: express.Request,
  orgId: string,
  insightIds: string[],
): Promise<Map<string, InsightDocument>> {
  const invalidId = insightIds.find((insightId) => !mongoose.isValidObjectId(insightId));
  if (invalidId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'insightIds must be valid ids');
  }

  const docs = await InsightModel.find({ _id: { $in: insightIds }, orgId });
  if (docs.length !== insightIds.length) {
    throw new AppError(404, 'INSIGHT_NOT_FOUND', 'One or more insights were not found');
  }
  for (const doc of docs) {
    await assertInsightVisible(req, doc);
  }

  return new Map(docs.map((doc) => [doc._id.toString(), doc]));
}

// Turns the stored IDashboardInsight[]/IDashboardLayoutItem[] refs (just ids) into the full
// DashboardInsightRef[]/DashboardLayoutItem[] contract shape — this is the "resolved" in
// "GET /:id (include resolved layout)": each insight's name/chartType is looked up fresh
// (never persisted redundantly), and layout rows for an insight no longer attached are
// dropped rather than surfaced as dangling entries.
async function resolveDashboardDTO(dashboard: DashboardDocument): Promise<Dashboard> {
  const insightIds = dashboard.insights.map((ref) => ref.insightId);
  const insightDocs =
    insightIds.length > 0 ? await InsightModel.find({ _id: { $in: insightIds }, orgId: dashboard.orgId }) : [];
  const insightById = new Map(insightDocs.map((doc) => [doc._id.toString(), doc]));

  const insights: DashboardInsightRef[] = dashboard.insights
    .map((ref) => {
      const insight = insightById.get(ref.insightId.toString());
      // Dangling reference — shouldn't happen (DELETE /api/insights/:id is blocked while
      // referenced by a dashboard), but dropped defensively rather than crashing the read.
      if (!insight) return null;
      return {
        insightId: asInsightId(insight._id.toString()),
        insightName: insight.name,
        chartType: insight.chartType,
      };
    })
    .filter((ref): ref is DashboardInsightRef => ref !== null);

  const liveInsightIds = new Set(insights.map((ref): string => ref.insightId));
  const layout: DashboardLayoutItem[] = dashboard.layout
    .filter((item) => liveInsightIds.has(item.insightId.toString()))
    .map((item) => ({
      insightId: asInsightId(item.insightId.toString()),
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    }));

  return toDashboardDTO(dashboard, insights, layout);
}

dashboardRouter.post(
  '/',
  authenticate,
  orgContext,
  validate({ body: createDashboardSchema }),
  requireScopedPermission('dashboards:manage' satisfies Permission, groupIdFromBody('groupId')),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const { groupId, projectId, name } = req.body as CreateDashboardInput;
    if (!mongoose.isValidObjectId(groupId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'groupId must be a valid id');
    }

    // createDashboardSchema carries no insightIds — a dashboard always starts empty;
    // insights are attached afterward one at a time via POST /:id/insights (or in bulk via
    // PUT /:id), both of which enforce the DASHBOARD_MAX_INSIGHTS cap.
    const doc = await DashboardModel.create({
      orgId: req.user.orgId,
      groupId,
      ownerId: req.user.id,
      projectId: projectId ?? null,
      name,
      insights: [],
      layout: [],
    });

    res.status(201).json(success(await resolveDashboardDTO(doc)));
  }),
);

const listDashboardsQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
});
type ListDashboardsQuery = z.infer<typeof listDashboardsQuerySchema>;

// No plain requirePermission gate — same reasoning as document.routes.ts's GET / and
// insight.routes.ts's GET /: the fixed flat-array check can't distinguish "no grant
// anywhere" from "grant scoped to some groups, not org-wide," and would 403 a
// group-scoped-only caller before resolveDocumentScope ever runs.
dashboardRouter.get(
  '/',
  authenticate,
  orgContext,
  validate({ query: listDashboardsQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const { projectId, page = 1 } = req.query as unknown as ListDashboardsQuery;
    if (projectId && !mongoose.isValidObjectId(projectId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'projectId must be a valid id');
    }

    const scope = await resolveDocumentScope(req.user, 'dashboards:read' satisfies Permission);
    if (!scope.orgWide && scope.allowedGroupIds.length === 0) {
      res
        .status(200)
        .json(success({ items: [], page, pageSize: PAGE_SIZE, total: 0, totalPages: 0 } satisfies PaginatedResult<Dashboard>));
      return;
    }

    const filter: Record<string, unknown> = { orgId: req.user.orgId };
    if (!scope.orgWide) {
      filter.groupId = { $in: scope.allowedGroupIds };
    }
    if (projectId) {
      filter.projectId = projectId;
    }

    const [docs, total] = await Promise.all([
      DashboardModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE),
      DashboardModel.countDocuments(filter),
    ]);

    const items = await Promise.all(docs.map((doc) => resolveDashboardDTO(doc)));
    const result: PaginatedResult<Dashboard> = {
      items,
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.ceil(total / PAGE_SIZE),
    };
    res.status(200).json(success(result));
  }),
);

dashboardRouter.get(
  '/:id',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Dashboard not found', 'DASHBOARD_NOT_FOUND');
    const doc = await DashboardModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!doc) {
      throw new AppError(404, 'DASHBOARD_NOT_FOUND', 'Dashboard not found');
    }
    await assertGroupPermission(req, 'dashboards:read' satisfies Permission, doc.groupId.toString());
    res.status(200).json(success(await resolveDashboardDTO(doc)));
  }),
);

dashboardRouter.put(
  '/:id',
  authenticate,
  orgContext,
  validate({ body: updateDashboardSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Dashboard not found', 'DASHBOARD_NOT_FOUND');
    const existing = await DashboardModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!existing) {
      throw new AppError(404, 'DASHBOARD_NOT_FOUND', 'Dashboard not found');
    }
    await assertGroupPermission(req, 'dashboards:manage' satisfies Permission, existing.groupId.toString());

    const body = req.body as UpdateDashboardInput;

    if (body.insightIds) {
      const uniqueIds = Array.from(new Set(body.insightIds));
      if (uniqueIds.length !== body.insightIds.length) {
        throw new AppError(400, 'VALIDATION_ERROR', 'insightIds must not contain duplicates');
      }
      // updateDashboardSchema already caps insightIds at DASHBOARD_MAX_INSIGHTS (a named
      // hard rule per the brief) — this re-check is defense-in-depth so it holds even if
      // that zod schema is ever loosened independently of this route.
      if (uniqueIds.length > DASHBOARD_MAX_INSIGHTS) {
        throw new AppError(
          400,
          'DASHBOARD_INSIGHT_LIMIT',
          `A dashboard can have at most ${DASHBOARD_MAX_INSIGHTS} insights`,
        );
      }
      await loadAttachableInsights(req, req.user.orgId, uniqueIds);
      existing.insights = uniqueIds.map((insightId) => ({ insightId: new mongoose.Types.ObjectId(insightId) }));

      // Changing the insight set can orphan layout rows for insights no longer attached —
      // drop them now rather than relying on resolveDashboardDTO's read-time filter alone.
      const stillAttached = new Set(uniqueIds);
      existing.layout = existing.layout.filter((item) => stillAttached.has(item.insightId.toString()));
    }

    if (body.layout) {
      const attachedIds = new Set(existing.insights.map((ref) => ref.insightId.toString()));
      const stray = body.layout.find((item) => !attachedIds.has(item.insightId));
      if (stray) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'layout references an insight that is not attached to this dashboard',
        );
      }
      existing.layout = body.layout.map((item) => ({
        insightId: new mongoose.Types.ObjectId(item.insightId),
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      }));
    }

    if (body.name !== undefined) {
      existing.name = body.name;
    }

    await existing.save();
    res.status(200).json(success(await resolveDashboardDTO(existing)));
  }),
);

dashboardRouter.delete(
  '/:id',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Dashboard not found', 'DASHBOARD_NOT_FOUND');
    const existing = await DashboardModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!existing) {
      throw new AppError(404, 'DASHBOARD_NOT_FOUND', 'Dashboard not found');
    }
    await assertGroupPermission(req, 'dashboards:manage' satisfies Permission, existing.groupId.toString());

    await DashboardModel.deleteOne({ _id: id, orgId: req.user.orgId });
    res.status(200).json(success(null));
  }),
);

const setDashboardLayoutSchema = z
  .object({ layout: z.array(dashboardLayoutItemSchema).max(DASHBOARD_MAX_INSIGHTS) })
  .strict();
type SetDashboardLayoutInput = z.infer<typeof setDashboardLayoutSchema>;

dashboardRouter.put(
  '/:id/layout',
  authenticate,
  orgContext,
  validate({ body: setDashboardLayoutSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Dashboard not found', 'DASHBOARD_NOT_FOUND');
    const existing = await DashboardModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!existing) {
      throw new AppError(404, 'DASHBOARD_NOT_FOUND', 'Dashboard not found');
    }
    await assertGroupPermission(req, 'dashboards:manage' satisfies Permission, existing.groupId.toString());

    const { layout } = req.body as SetDashboardLayoutInput;
    const attachedIds = new Set(existing.insights.map((ref) => ref.insightId.toString()));
    const stray = layout.find((item) => !attachedIds.has(item.insightId));
    if (stray) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'layout references an insight that is not attached to this dashboard',
      );
    }

    existing.layout = layout.map((item) => ({
      insightId: new mongoose.Types.ObjectId(item.insightId),
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    }));
    await existing.save();
    res.status(200).json(success(await resolveDashboardDTO(existing)));
  }),
);

const addDashboardInsightSchema = z.object({ insightId: z.string().min(1) }).strict();
type AddDashboardInsightInput = z.infer<typeof addDashboardInsightSchema>;

dashboardRouter.post(
  '/:id/insights',
  authenticate,
  orgContext,
  validate({ body: addDashboardInsightSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Dashboard not found', 'DASHBOARD_NOT_FOUND');
    const existing = await DashboardModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!existing) {
      throw new AppError(404, 'DASHBOARD_NOT_FOUND', 'Dashboard not found');
    }
    await assertGroupPermission(req, 'dashboards:manage' satisfies Permission, existing.groupId.toString());

    const { insightId } = req.body as AddDashboardInsightInput;
    if (!mongoose.isValidObjectId(insightId)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'insightId must be a valid id');
    }
    // The named hard rule: reject a 4th insight rather than silently dropping the oldest.
    if (existing.insights.length >= DASHBOARD_MAX_INSIGHTS) {
      throw new AppError(
        400,
        'DASHBOARD_INSIGHT_LIMIT',
        `A dashboard can have at most ${DASHBOARD_MAX_INSIGHTS} insights`,
      );
    }
    if (existing.insights.some((ref) => ref.insightId.toString() === insightId)) {
      throw new ConflictError('This insight is already on the dashboard', 'DASHBOARD_INSIGHT_EXISTS');
    }
    await loadAttachableInsights(req, req.user.orgId, [insightId]);

    existing.insights.push({ insightId: new mongoose.Types.ObjectId(insightId) });
    await existing.save();
    res.status(201).json(success(await resolveDashboardDTO(existing)));
  }),
);

dashboardRouter.delete(
  '/:id/insights/:insightId',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Dashboard not found', 'DASHBOARD_NOT_FOUND');
    const insightId = parseObjectIdParam(
      req.params.insightId,
      'Insight not found on this dashboard',
      'DASHBOARD_INSIGHT_NOT_FOUND',
    );
    const existing = await DashboardModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!existing) {
      throw new AppError(404, 'DASHBOARD_NOT_FOUND', 'Dashboard not found');
    }
    await assertGroupPermission(req, 'dashboards:manage' satisfies Permission, existing.groupId.toString());

    const wasAttached = existing.insights.some((ref) => ref.insightId.toString() === insightId);
    if (!wasAttached) {
      throw new AppError(404, 'DASHBOARD_INSIGHT_NOT_FOUND', 'Insight not found on this dashboard');
    }

    existing.insights = existing.insights.filter((ref) => ref.insightId.toString() !== insightId);
    existing.layout = existing.layout.filter((item) => item.insightId.toString() !== insightId);
    await existing.save();
    res.status(200).json(success(await resolveDashboardDTO(existing)));
  }),
);
