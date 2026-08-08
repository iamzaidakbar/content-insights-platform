import express from 'express';
import { z } from 'zod';

import {
  asUserId,
  updateUserSchema,
  type Permission,
  type UpdateUserInput,
  type UserSummary,
} from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { clearRefreshCookie } from '../lib/cookies.js';
import { AppError } from '../lib/errors.js';
import { success } from '../lib/response.js';
import { toUserDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { orgContext } from '../middleware/orgContext.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { validate } from '../middleware/validate.js';
import { UserModel } from '../models/user.model.js';

export const userRouter = express.Router();

const SEARCH_RESULT_LIMIT = 20;

const userSearchQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
});
type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

userRouter.get(
  '/',
  authenticate,
  orgContext,
  requirePermission('projects:manage' satisfies Permission),
  validate({ query: userSearchQuerySchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { search } = req.query as unknown as UserSearchQuery;
    if (!search) {
      res.status(200).json(success([] as UserSummary[]));
      return;
    }

    const escaped = escapeRegex(search);
    const users = await UserModel.find({
      orgId: req.user.orgId,
      email: { $regex: escaped, $options: 'i' },
    }).limit(SEARCH_RESULT_LIMIT);

    const results: UserSummary[] = users.map((u) => ({ id: asUserId(u._id.toString()), email: u.email }));
    res.status(200).json(success(results));
  }),
);

userRouter.patch(
  '/me',
  authenticate,
  validate({ body: updateUserSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    const { displayName } = req.body as UpdateUserInput;
    const user = await UserModel.findByIdAndUpdate(req.user.id, { displayName }, { new: true });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    res.status(200).json(success(toUserDTO(user)));
  }),
);

userRouter.delete(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    await UserModel.findByIdAndDelete(req.user.id);
    // Same as /auth/logout — clears the httpOnly refresh cookie so the now-deleted
    // user's session can't be silently refreshed into a 401 loop.
    clearRefreshCookie(res);
    res.status(200).json(success(null));
  }),
);
