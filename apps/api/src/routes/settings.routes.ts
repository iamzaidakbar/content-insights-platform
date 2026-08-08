import express from 'express';
import mongoose from 'mongoose';

import {
  DEFAULT_USER_SETTINGS,
  updateUserSettingsSchema,
  type UpdateUserSettingsInput,
  type UserSettingsDefaults,
} from '@content-insights/shared';

import { asyncHandler } from '../lib/async-handler.js';
import { AppError } from '../lib/errors.js';
import { flattenToDotNotation } from '../lib/flatten.js';
import { success } from '../lib/response.js';
import { toUserSettingsDTO } from '../lib/serializers.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { UserSettingsModel, type UserSettingsDocument } from '../models/userSettings.model.js';

export const settingsRouter = express.Router();

// Shared by GET /me and PATCH /me — both need a guaranteed-to-exist record before doing
// anything else. find-then-create (not a blind upsert) so a first-ever GET and a
// first-ever PATCH both converge on exactly one seeded document, never two partial ones.
async function getOrCreateUserSettings(
  userId: mongoose.Types.ObjectId | string,
  orgId: mongoose.Types.ObjectId | string,
): Promise<UserSettingsDocument> {
  const existing = await UserSettingsModel.findOne({ userId, orgId });
  if (existing) {
    return existing;
  }
  try {
    return await UserSettingsModel.create({ userId, orgId });
  } catch (err) {
    // Race: another concurrent request created it first (unique index on
    // {userId, orgId}) — re-read rather than erroring.
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === 11000
    ) {
      const record = await UserSettingsModel.findOne({ userId, orgId });
      if (record) {
        return record;
      }
    }
    throw err;
  }
}

settingsRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }
    const settings = await getOrCreateUserSettings(req.user.id, req.user.orgId);
    res.status(200).json(success(toUserSettingsDTO(settings)));
  }),
);

settingsRouter.patch(
  '/me',
  authenticate,
  validate({ body: updateUserSettingsSchema }),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing authenticated request context');
    }

    // Ensure a record exists first, so a PATCH sent before any GET still lands on a
    // fully-defaulted document instead of an upsert with only the patched fields set.
    await getOrCreateUserSettings(req.user.id, req.user.orgId);

    const body = req.body as UpdateUserSettingsInput;
    const updates = flattenToDotNotation(body);

    const updated = await UserSettingsModel.findOneAndUpdate(
      { userId: req.user.id, orgId: req.user.orgId },
      { $set: updates },
      { new: true },
    );
    if (!updated) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Failed to update settings');
    }

    res.status(200).json(success(toUserSettingsDTO(updated)));
  }),
);

settingsRouter.get(
  '/defaults',
  asyncHandler(async (_req, res) => {
    res.status(200).json(success(DEFAULT_USER_SETTINGS satisfies UserSettingsDefaults));
  }),
);
