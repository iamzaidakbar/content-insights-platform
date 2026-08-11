import express from 'express';
import { z } from 'zod';

import {
  asConceptId,
  asOrgId,
  asProjectId,
  createConceptSchema,
  updateConceptSchema,
  EMPTY_FILTER_PANEL_STATE,
  type Concept,
  type CreateConceptInput,
  type FacetBucket,
  type FilterPanelState,
  type Permission,
  type UpdateConceptInput,
} from '@content-insights/shared';

import { audit } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ForbiddenError, isDuplicateKeyError } from '../lib/errors.js';
import { objectIdSchema, parseObjectIdParam } from '../lib/objectId.js';
import { success } from '../lib/response.js';
import { executeArticleFacets, type ArticleSearchGrants } from '../lib/search.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { ConceptModel, type ConceptDocument } from '../models/concept.model.js';
import { ProjectModel } from '../models/project.model.js';
import type { AuthenticatedUser } from '../types/express.js';

export const conceptRouter = express.Router();

// GET /:id/values returns the FULL raw universe of indexed values for the concept's key,
// unfiltered by any group's hard-filter grant — a generous cap, not a UI page size.
const VALUES_FACET_SIZE = 1000;

// Router is mounted flatly at /api/concepts (not nested under /api/projects/:projectId —
// see project.routes.ts's own mount comment), so the owning project is carried as a query
// param on both GET / and POST /, validated the same way as any other id.
const conceptProjectQuerySchema = z.object({ projectId: objectIdSchema });
type ConceptProjectQuery = z.infer<typeof conceptProjectQuerySchema>;

function toConceptDTO(doc: ConceptDocument): Concept {
  return {
    id: asConceptId(doc._id.toString()),
    orgId: asOrgId(doc.orgId.toString()),
    projectId: asProjectId(doc.projectId.toString()),
    name: doc.name,
    key: doc.key,
    placement: doc.placement,
    order: doc.order,
    displayLabel: doc.displayLabel,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

// GET /:id/values powers the admin hard-filter-grant picker (which raw values exist for
// this concept, so an admin can choose which ones to allow a group to see) — it must never
// be reachable by an ordinary searcher, since it deliberately bypasses every group's
// hardFilterGrants. requirePermission only ever takes one key, so this either-of check
// (mirrors audit.routes.ts's assertCanReadAudit) is inline. Global scope only: there's no
// groupId in this URL to scope against (the grant being configured lives on a Group this
// endpoint never sees), so a group-scoped-only concepts:manage/groups:manageDataAccess grant
// does not pass here — matches this codebase's existing org-wide-only admin gates
// (org:admin, audit:read).
function assertCanViewConceptValues(user: AuthenticatedUser): void {
  const permissions = user.globalPermissions;
  if (
    permissions.includes('*') ||
    permissions.includes('concepts:manage' satisfies Permission) ||
    permissions.includes('groups:manageDataAccess' satisfies Permission)
  ) {
    return;
  }
  throw new ForbiddenError('Missing required permission: concepts:manage or groups:manageDataAccess');
}

// No permission gate beyond org membership — concept definitions (name/key/placement/order)
// are filter-panel schema metadata every authenticated org member needs to render search, not
// sensitive data. The sensitive part (which VALUES exist for a hard concept) is protected
// separately by GET /:id/values above and by the search/facets endpoints' hard-filter-grant
// enforcement (lib/search.ts), never by hiding the concept's existence itself.
conceptRouter.get(
  '/',
  authenticate,
  orgContext,
  validate({ query: conceptProjectQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const { projectId } = req.query as unknown as ConceptProjectQuery;

    const project = await ProjectModel.findOne({ _id: projectId, orgId: req.user.orgId });
    if (!project) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const concepts = await ConceptModel.find({ orgId: req.user.orgId, projectId }).sort({
      order: 1,
      createdAt: 1,
    });
    res.status(200).json(success(concepts.map(toConceptDTO) satisfies Concept[]));
  }),
);

conceptRouter.post(
  '/',
  authenticate,
  orgContext,
  requirePermission('concepts:manage' satisfies Permission),
  validate({ query: conceptProjectQuerySchema, body: createConceptSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const { projectId } = req.query as unknown as ConceptProjectQuery;
    const { name, key, placement, displayLabel } = req.body as CreateConceptInput;

    const project = await ProjectModel.findOne({ _id: projectId, orgId: req.user.orgId });
    if (!project) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    // Enforced here at the route level (not just left to the model's unique index) so the
    // caller gets a clean, explicit 409 rather than a raw duplicate-key error — the index
    // itself (see concept.model.ts) stays in place as a race-safety net, handled in the
    // catch below.
    const normalizedName = name.toLowerCase();
    const existingByName = await ConceptModel.findOne({ projectId, normalizedName });
    if (existingByName) {
      throw new AppError(
        409,
        'CONCEPT_NAME_TAKEN',
        `A concept named "${name}" already exists in this project`,
      );
    }

    try {
      // Appends at the end of this project's existing order sequence — reorderConceptsSchema
      // (PUT /api/projects/:projectId/concepts/reorder, not yet wired to a route) is what
      // lets an admin subsequently reshuffle it.
      const order = await ConceptModel.countDocuments({ projectId });
      const doc = await ConceptModel.create({
        orgId: req.user.orgId,
        projectId,
        name,
        key,
        placement,
        displayLabel,
        order,
      });

      audit(req, {
        action: 'concept.create',
        entityType: 'concept',
        entityId: doc._id.toString(),
        details: { name, key, projectId },
      });

      res.status(201).json(success(toConceptDTO(doc)));
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        if (err.keyPattern?.key) {
          throw new AppError(
            409,
            'CONCEPT_KEY_TAKEN',
            `A concept with key "${key}" already exists in this project`,
          );
        }
        throw new AppError(
          409,
          'CONCEPT_NAME_TAKEN',
          `A concept named "${name}" already exists in this project`,
        );
      }
      throw err;
    }
  }),
);

conceptRouter.put(
  '/:id',
  authenticate,
  orgContext,
  requirePermission('concepts:manage' satisfies Permission),
  validate({ body: updateConceptSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Concept not found', 'CONCEPT_NOT_FOUND');
    const body = req.body as UpdateConceptInput;

    // findOneAndUpdate is a Query, not a Document — the model's pre('validate') hook that
    // derives normalizedName from name (see concept.model.ts) only runs on Document
    // validation, never here, so a name change must re-derive it explicitly.
    const update: Record<string, unknown> = { ...body };
    if (body.name !== undefined) {
      update.normalizedName = body.name.toLowerCase();
    }

    try {
      const doc = await ConceptModel.findOneAndUpdate(
        { _id: id, orgId: req.user.orgId },
        { $set: update },
        { new: true, runValidators: true },
      );
      if (!doc) {
        throw new AppError(404, 'CONCEPT_NOT_FOUND', 'Concept not found');
      }

      audit(req, {
        action: 'concept.update',
        entityType: 'concept',
        entityId: id,
        details: { updatedFields: Object.keys(body) },
      });

      res.status(200).json(success(toConceptDTO(doc)));
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new AppError(
          409,
          'CONCEPT_NAME_TAKEN',
          `A concept named "${body.name}" already exists in this project`,
        );
      }
      throw err;
    }
  }),
);

conceptRouter.delete(
  '/:id',
  authenticate,
  orgContext,
  requirePermission('concepts:manage' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const id = parseObjectIdParam(req.params.id, 'Concept not found', 'CONCEPT_NOT_FOUND');

    const doc = await ConceptModel.findOneAndDelete({ _id: id, orgId: req.user.orgId });
    if (!doc) {
      throw new AppError(404, 'CONCEPT_NOT_FOUND', 'Concept not found');
    }

    audit(req, {
      action: 'concept.delete',
      entityType: 'concept',
      entityId: id,
      details: { name: doc.name, key: doc.key, projectId: doc.projectId.toString() },
    });

    res.status(200).json(success(null));
  }),
);

interface ConceptValuesResponse {
  values: FacetBucket[];
}

conceptRouter.get(
  '/:id/values',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    assertCanViewConceptValues(req.user);
    const id = parseObjectIdParam(req.params.id, 'Concept not found', 'CONCEPT_NOT_FOUND');

    const concept = await ConceptModel.findOne({ _id: id, orgId: req.user.orgId });
    if (!concept) {
      throw new AppError(404, 'CONCEPT_NOT_FOUND', 'Concept not found');
    }

    const projectId = concept.projectId.toString();
    // Generous + unfiltered: scoped only to this concept's own project, no hard-filter grant
    // restriction (empty hardFilterGrants) and no other filter narrowing — this is
    // deliberately the full raw value universe an admin picks a group's allowed subset from,
    // not what an ordinary searcher would ever see (see assertCanViewConceptValues above).
    const filters: FilterPanelState = { ...EMPTY_FILTER_PANEL_STATE, projectIds: [projectId] };
    const grants: ArticleSearchGrants = {
      projectIds: [projectId],
      hardFilterGrants: [],
      softFilterConceptKeys: [],
    };

    const { facets } = await executeArticleFacets(req.user.orgId, {
      filters,
      grants,
      conceptKeys: [concept.key],
      sort: 'az',
      excludeZeroCounts: true,
      size: VALUES_FACET_SIZE,
    });

    res.status(200).json(success({ values: facets[concept.key] ?? [] } satisfies ConceptValuesResponse));
  }),
);
