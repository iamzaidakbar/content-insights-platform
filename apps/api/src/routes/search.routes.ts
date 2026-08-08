import express from 'express';

import { searchRequestSchema, type SearchResponse } from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { success } from '../lib/response.js';
import { executeSearch } from '../lib/search.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';

export const searchRouter = express.Router();

searchRouter.post(
  '/',
  authenticate,
  orgContext,
  requirePermission('document:read'),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const parsed = searchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message ?? 'Invalid request body',
      );
    }

    const result: SearchResponse = await executeSearch({ ...parsed.data, orgId: req.user.orgId });
    res.status(200).json(success(result));
  }),
);
