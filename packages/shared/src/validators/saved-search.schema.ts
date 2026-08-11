import { z } from 'zod';

import { MAX_SNAPSHOT_NAME_LENGTH, SAVED_SEARCH_TYPES } from '../types/saved-search.js';
import { filterPanelStateSchema } from './search-filters.schema.js';

export const savedSearchTypeSchema = z.enum(SAVED_SEARCH_TYPES);

export const savedSearchShareGrantSchema = z
  .object({
    groupId: z.string().min(1),
    groupName: z.string().min(1),
  })
  .strict();

// POST /api/saved-searches — snapshotLocationHashes is never client-supplied: for
// type === 'snapshot' the API resolves and freezes the current result set server-side.
export const createSavedSearchSchema = z
  .object({
    groupId: z.string().min(1),
    name: z.string().trim().min(1).max(MAX_SNAPSHOT_NAME_LENGTH),
    type: savedSearchTypeSchema.default('dynamic'),
    filters: filterPanelStateSchema,
  })
  .strict();
export type CreateSavedSearchInput = z.infer<typeof createSavedSearchSchema>;

// PUT /api/saved-searches/:id
export const updateSavedSearchSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_SNAPSHOT_NAME_LENGTH).optional(),
    filters: filterPanelStateSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one of name or filters must be provided',
  });
export type UpdateSavedSearchInput = z.infer<typeof updateSavedSearchSchema>;

// POST /api/saved-searches/:id/share — saved-searches:shareIntoGroups
export const shareSavedSearchSchema = z
  .object({
    groupIds: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type ShareSavedSearchInput = z.infer<typeof shareSavedSearchSchema>;

// PUT /api/saved-searches/:id/channel — saved-searches:publish; expose or demote a saved
// search as a navbar channel (audit.ts's channel.expose/channel.demote actions).
export const setChannelSchema = z
  .object({
    isChannel: z.boolean(),
    channelName: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.isChannel && !body.channelName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['channelName'],
        message: 'channelName is required when exposing a saved search as a channel',
      });
    }
  });
export type SetChannelInput = z.infer<typeof setChannelSchema>;

// POST /api/saved-searches/:id/run
export const runSavedSearchSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    size: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type RunSavedSearchInput = z.infer<typeof runSavedSearchSchema>;

// GET /api/saved-searches
export const listSavedSearchesQuerySchema = z.object({
  scope: z.enum(['mine', 'channels']).default('mine'),
  groupId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
});
export type ListSavedSearchesQuery = z.infer<typeof listSavedSearchesQuerySchema>;
