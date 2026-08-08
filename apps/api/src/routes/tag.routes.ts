import express from 'express';

import { createTagSchema, type CreateTagInput, type Permission, type Tag } from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError, isDuplicateKeyError } from '../lib/errors.js';
import { success } from '../lib/response.js';
import { toTagDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { TagModel } from '../models/tag.model.js';

export const tagRouter = express.Router();

// GET /?orgId= — the query param is accepted (matches the literal spec's URL shape) but
// unused: like every other org-scoped route in this codebase, the org is always taken from
// the authenticated req.user.orgId, never a client-supplied query value.
tagRouter.get(
  '/',
  authenticate,
  orgContext,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const tags = await TagModel.find({ orgId: req.user.orgId }).sort({ count: -1, name: 1 });
    res.status(200).json(success(tags.map(toTagDTO) satisfies Tag[]));
  }),
);

// Reuses 'documents:write' rather than adding a 7th permission key — tagging is a
// content-organization action available to the same editor/admin roles that can already
// write documents, and adding a dedicated permission would require reseeding every
// existing org's roles, out of scope for this UI-focused task.
tagRouter.post(
  '/',
  authenticate,
  orgContext,
  requirePermission('documents:write' satisfies Permission),
  validate({ body: createTagSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { name, color } = req.body as CreateTagInput;

    try {
      const tag = await TagModel.create({ orgId: req.user.orgId, name, color });
      res.status(201).json(success(toTagDTO(tag)));
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new AppError(409, 'TAG_NAME_TAKEN', 'A tag with this name already exists');
      }
      throw err;
    }
  }),
);
