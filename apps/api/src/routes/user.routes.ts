import express from 'express';

import { asUserId, type Permission, type UserSummary } from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { success } from '../lib/response.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { UserModel } from '../models/user.model.js';

export const userRouter = express.Router();

const SEARCH_RESULT_LIMIT = 20;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

userRouter.get(
  '/',
  authenticate,
  orgContext,
  requirePermission('projects:manage' satisfies Permission),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (rawSearch.length === 0) {
      res.status(200).json(success([] as UserSummary[]));
      return;
    }

    const escaped = escapeRegex(rawSearch);
    const users = await UserModel.find({
      orgId: req.user.orgId,
      email: { $regex: escaped, $options: 'i' },
    }).limit(SEARCH_RESULT_LIMIT);

    const results: UserSummary[] = users.map((u) => ({ id: asUserId(u._id.toString()), email: u.email }));
    res.status(200).json(success(results));
  }),
);
