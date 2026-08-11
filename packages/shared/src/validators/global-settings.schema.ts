import { z } from 'zod';

export const msTeamsGlobalSettingsSchema = z
  .object({
    hideIcons: z.boolean(),
    maxArticlesPerShare: z.number().int().min(1).max(100),
    defaultBulkMessage: z.string().trim().max(1000),
  })
  .strict();

export const articleFieldMappingSettingsSchema = z
  .object({
    titleConceptKey: z.string().min(1).nullable().optional(),
    locationConceptKey: z.string().min(1).nullable().optional(),
    publishedDateConceptKey: z.string().min(1).nullable().optional(),
  })
  .strict();

// PATCH /api/global-settings — global-settings:manage
export const updateGlobalSettingsSchema = z
  .object({
    maxSnapshotArticles: z.number().int().min(1).max(10_000).optional(),
    msTeams: msTeamsGlobalSettingsSchema.partial().strict().optional(),
    articleFieldMapping: articleFieldMappingSettingsSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateGlobalSettingsInput = z.infer<typeof updateGlobalSettingsSchema>;
