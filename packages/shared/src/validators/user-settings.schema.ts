import { z } from 'zod';

export const themeSchema = z.enum(['light', 'dark', 'system']);
export const fontSizeSchema = z.enum(['small', 'medium', 'large']);
export const cardDensitySchema = z.enum(['comfortable', 'compact', 'cozy']);
export const searchPageSizeSchema = z.union([z.literal(12), z.literal(24), z.literal(48)]);
export const searchSortSchema = z.enum(['publishDate', 'relevance', 'source']);
export const searchLayoutSchema = z.enum(['1col', '2col', '3col', 'dense']);
export const openArticleInSchema = z.enum(['newTab', 'sameTab', 'sidePanel']);
export const digestFrequencySchema = z.enum(['daily', 'weekly']);

export const appearanceSettingsSchema = z.object({
  theme: themeSchema,
  fontSize: fontSizeSchema,
  compactSidebar: z.boolean(),
  cardDensity: cardDensitySchema,
});

export const searchSettingsSchema = z.object({
  defaultPageSize: searchPageSizeSchema,
  defaultSort: searchSortSchema,
  defaultLayout: searchLayoutSchema,
  openArticleIn: openArticleInSchema,
});

export const inAppAlertSettingsSchema = z.object({
  breakingNews: z.boolean(),
  tagMatches: z.boolean(),
  system: z.boolean(),
});

export const notificationSettingsSchema = z.object({
  emailDigest: z.boolean(),
  emailDigestFrequency: digestFrequencySchema,
  inAppAlerts: inAppAlertSettingsSchema,
});

export const userSettingsSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  orgId: z.string().min(1),
  appearance: appearanceSettingsSchema,
  search: searchSettingsSchema,
  notifications: notificationSettingsSchema,
  updatedAt: z.string(),
});
export type UserSettingsInput = z.infer<typeof userSettingsSchema>;

// PATCH /api/settings/me — every leaf optional (nested partial, not full replace), but
// any leaf that IS sent must still satisfy its enum/type. Every level uses .strict() so
// an unrecognized key (typo, or a client sending a field this API doesn't know about)
// is rejected with a clear 400 instead of being silently ignored.
export const updateUserSettingsSchema = z
  .object({
    appearance: appearanceSettingsSchema.partial().strict().optional(),
    search: searchSettingsSchema.partial().strict().optional(),
    notifications: z
      .object({
        emailDigest: z.boolean().optional(),
        emailDigestFrequency: digestFrequencySchema.optional(),
        inAppAlerts: inAppAlertSettingsSchema.partial().strict().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;
