import express from 'express';
import mongoose from 'mongoose';

import {
  mapEntityMappingEntrySchema,
  type MapEntityMappingEntryInput,
  type Permission,
  type UpstreamEntityType,
} from '@content-insights/shared';

import { audit } from '../lib/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ForbiddenError, isDuplicateKeyError, NotFoundError } from '../lib/errors.js';
import { parseObjectIdParam } from '../lib/objectId.js';
import { success } from '../lib/response.js';
import { toEntityMappingDTO } from '../lib/serializers.js';
import { slugify } from '../lib/slug.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { ArticleModel } from '../models/article.model.js';
import { ConceptModel } from '../models/concept.model.js';
import { EntityMappingModel, type EntityMappingDocument } from '../models/entityMapping.model.js';
import { ProjectModel } from '../models/project.model.js';

export const entityMappingRouter = express.Router();

// ---------------------------------------------------------------------------------------
// No live upstream content-platform integration (e.g. an external CMS/DAM API) is
// configured in this environment — there are no credentials to call out to a real
// "upstream" system with. POST /sync below is therefore NOT a real sync: it treats the
// org's own already-ingested data (Projects, Concepts, and the distinct Article.domain
// values in Elasticsearch/Mongo) as a stand-in source of truth for "what entities exist
// upstream," so the mapping UI has something real and org-specific to reconcile against
// rather than being permanently empty. This is the honest option absent real upstream
// credentials, and the EntityMapping document shape doesn't need to change once a real
// upstream API is wired in — only the body of the POST /sync handler below would.
// ---------------------------------------------------------------------------------------
const UPSTREAM_SYSTEM = 'content-platform';

// One mapping document per org for the (single, simulated) upstream system above —
// find-then-create, not a blind upsert, matching every other org-singleton in this
// codebase (see settings.routes.ts's getOrCreateUserSettings for the canonical version).
async function getOrCreateEntityMapping(orgId: string): Promise<EntityMappingDocument> {
  const existing = await EntityMappingModel.findOne({ orgId, upstreamSystem: UPSTREAM_SYSTEM });
  if (existing) {
    return existing;
  }
  try {
    return await EntityMappingModel.create({ orgId, upstreamSystem: UPSTREAM_SYSTEM });
  } catch (err) {
    // Race: another concurrent request created it first (unique index on
    // {orgId, upstreamSystem}) — re-read rather than erroring.
    if (isDuplicateKeyError(err)) {
      const record = await EntityMappingModel.findOne({ orgId, upstreamSystem: UPSTREAM_SYSTEM });
      if (record) {
        return record;
      }
    }
    throw err;
  }
}

// Readable by holders of either the read or the manage permission — someone who can
// already edit the mapping shouldn't also need the separate read grant just to view it.
function assertCanReadEntityMapping(globalPermissions: string[]): void {
  if (
    !globalPermissions.includes('*') &&
    !globalPermissions.includes('entity-mapping:read' satisfies Permission) &&
    !globalPermissions.includes('entity-mapping:manage' satisfies Permission)
  ) {
    throw new ForbiddenError('Missing required permission: entity-mapping:read');
  }
}

// Resolves the display name for whatever local entity a manual mapping points at, and
// 404s if it doesn't resolve to a real record in this org. 'source' has no dedicated
// model in this codebase — a source's "local id" IS the literal domain string, so it's
// accepted as-is (there's nothing further to look up or to belong to another org).
async function resolveLocalName(
  localType: UpstreamEntityType,
  localId: string,
  orgId: string,
): Promise<string | null> {
  if (localType === 'project') {
    if (!mongoose.isValidObjectId(localId)) {
      throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    }
    const project = await ProjectModel.findOne({ _id: localId, orgId }, { name: 1 });
    if (!project) {
      throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    }
    return project.name;
  }
  if (localType === 'concept') {
    if (!mongoose.isValidObjectId(localId)) {
      throw new NotFoundError('Concept not found', 'CONCEPT_NOT_FOUND');
    }
    const concept = await ConceptModel.findOne({ _id: localId, orgId }, { name: 1 });
    if (!concept) {
      throw new NotFoundError('Concept not found', 'CONCEPT_NOT_FOUND');
    }
    return concept.name;
  }
  return localId;
}

entityMappingRouter.get(
  '/',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    assertCanReadEntityMapping(req.user.globalPermissions);

    const mapping = await getOrCreateEntityMapping(req.user.orgId);
    res.status(200).json(success(toEntityMappingDTO(mapping)));
  }),
);

entityMappingRouter.post(
  '/sync',
  authenticate,
  orgContext,
  requirePermission('entity-mapping:manage' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const orgId = req.user.orgId;
    const mapping = await getOrCreateEntityMapping(orgId);

    // See the module comment above — this "discovers" candidate entities from the org's
    // own already-ingested data, standing in for a real upstream content-platform API.
    const [projects, concepts, domains] = await Promise.all([
      ProjectModel.find({ orgId }, { name: 1 }),
      ConceptModel.find({ orgId }, { name: 1 }),
      ArticleModel.distinct('domain', { orgId }),
    ]);

    const seenKeys = new Set(mapping.entries.map((entry) => `${entry.upstreamType}:${entry.upstreamId}`));
    let addedCount = 0;

    // Adds one new 'unmapped' entry per not-yet-seen (upstreamType, upstreamId) pair.
    // Existing entries (whether already manually mapped or already flagged unmapped from a
    // prior sync) are left untouched — a re-sync only ever discovers new candidates, it
    // never overwrites an admin's existing mapping decision.
    function addUnmappedEntry(upstreamType: UpstreamEntityType, upstreamName: string): void {
      const upstreamId = slugify(upstreamName);
      if (!upstreamId) {
        return;
      }
      const key = `${upstreamType}:${upstreamId}`;
      if (seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      mapping.entries.push({
        _id: new mongoose.Types.ObjectId(),
        upstreamType,
        upstreamId,
        upstreamName,
        // Defaults to the same category as the discovered item — still 'unmapped' until an
        // admin explicitly confirms (or redirects) it via PUT /:entryId.
        localType: upstreamType,
        localId: null,
        localName: null,
        lastSyncedAt: null,
        status: 'unmapped',
      });
      addedCount += 1;
    }

    for (const project of projects) {
      addUnmappedEntry('project', project.name);
    }
    for (const concept of concepts) {
      addUnmappedEntry('concept', concept.name);
    }
    for (const domain of domains) {
      if (typeof domain === 'string' && domain.trim().length > 0) {
        addUnmappedEntry('source', domain);
      }
    }

    if (addedCount > 0) {
      await mapping.save();
    }

    audit(req, {
      action: 'entity-mapping.sync',
      entityType: 'entity-mapping',
      entityId: mapping._id.toString(),
      details: { upstreamSystem: UPSTREAM_SYSTEM, addedCount, totalEntries: mapping.entries.length },
    });

    res.status(200).json(success(toEntityMappingDTO(mapping)));
  }),
);

entityMappingRouter.put(
  '/:entryId',
  authenticate,
  orgContext,
  requirePermission('entity-mapping:manage' satisfies Permission),
  validate({ body: mapEntityMappingEntrySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const entryId = parseObjectIdParam(
      req.params.entryId,
      'Entity mapping entry not found',
      'ENTITY_MAPPING_ENTRY_NOT_FOUND',
    );
    const body = req.body as MapEntityMappingEntryInput;

    const mapping = await getOrCreateEntityMapping(req.user.orgId);
    // Plain array .find() (not Mongoose DocumentArray's .id() helper) — IEntityMapping.entries
    // is typed as a plain IEntityMappingEntry[], so TS sees this as an ordinary array; the
    // found element is still the real subdocument underneath, so mutating it below is still
    // tracked by Mongoose's normal change detection ahead of mapping.save().
    const entry = mapping.entries.find((candidate) => candidate._id.toString() === entryId);
    if (!entry) {
      throw new NotFoundError('Entity mapping entry not found', 'ENTITY_MAPPING_ENTRY_NOT_FOUND');
    }

    if (body.localId === null) {
      // Unmap: schema comment on mapEntityMappingEntrySchema documents localId: null as the
      // explicit "unmap" signal.
      entry.localType = body.localType;
      entry.localId = null;
      entry.localName = null;
      entry.status = 'unmapped';
      entry.lastSyncedAt = null;
    } else {
      const localName = await resolveLocalName(body.localType, body.localId, req.user.orgId);
      entry.localType = body.localType;
      entry.localId = body.localId;
      entry.localName = localName;
      entry.status = 'mapped';
      entry.lastSyncedAt = new Date();
    }

    await mapping.save();
    res.status(200).json(success(toEntityMappingDTO(mapping)));
  }),
);
