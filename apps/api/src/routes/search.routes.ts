import express from 'express';

import { searchRequestSchema, type Permission, type SearchRequestInput, type SearchResponse } from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { success } from '../lib/response.js';
import { executeSearch } from '../lib/search.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { searchRateLimiter } from '../middleware/rateLimiters.js';
import { validate } from '../middleware/validate.js';

export const searchRouter = express.Router();

searchRouter.post(
  '/',
  authenticate,
  // Runs right after authenticate (before orgContext's DB lookup) since the org-scoped
  // rate-limit key only needs req.user.orgId, already available from the JWT claims.
  searchRateLimiter,
  orgContext,
  requirePermission('search:query' satisfies Permission),
  validate({ body: searchRequestSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const body = req.body as SearchRequestInput;
    const result: SearchResponse = await executeSearch({ ...body, orgId: req.user.orgId });
    res.status(200).json(success(result));
  }),
);
