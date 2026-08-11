import { z } from 'zod';

import { DATE_FORMATS, RESULT_VIEW_MODES } from '../types/user-settings.js';
import { facetSortOrderSchema } from './search-filters.schema.js';

export const themeSchema = z.enum(['light', 'dark', 'system']);
export const dateFormatSchema = z.enum(DATE_FORMATS);
export const resultViewModeSchema = z.enum(RESULT_VIEW_MODES);

export const userSettingsSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  orgId: z.string().min(1),
  theme: themeSchema,
  dateFormat: dateFormatSchema,
  facetSortOrder: facetSortOrderSchema,
  hideZeroCountFacets: z.boolean(),
  cardContentLines: z.record(z.number().int().min(1).max(20)),
  languagePreference: z.string().min(1),
  defaultResultView: resultViewModeSchema,
  updatedAt: z.string(),
});
export type UserSettingsInput = z.infer<typeof userSettingsSchema>;

// PATCH /api/settings/me — every field optional (partial patch, not full replace), but any
// field that IS sent must still satisfy its enum/type. .strict() so an unrecognized key
// (typo, or a client sending a field this API doesn't know about) is rejected with a clear
// 400 instead of being silently ignored. cardContentLines is replaced wholesale when sent
// (not merged key-by-key) — same "atomic leaf" treatment as the old lastUsedFilters field.
export const updateUserSettingsSchema = z
  .object({
    theme: themeSchema.optional(),
    dateFormat: dateFormatSchema.optional(),
    facetSortOrder: facetSortOrderSchema.optional(),
    hideZeroCountFacets: z.boolean().optional(),
    cardContentLines: z.record(z.number().int().min(1).max(20)).optional(),
    languagePreference: z.string().trim().min(2).max(35).optional(),
    defaultResultView: resultViewModeSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;
