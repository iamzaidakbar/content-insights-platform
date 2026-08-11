import { z } from 'zod';

import { CHART_TYPES, INSIGHT_NAME_MAX_LENGTH, WORD_CLOUD_MAX_WORDS } from '../types/insight.js';
import { filterPanelStateSchema } from './search-filters.schema.js';

export const chartTypeSchema = z.enum(CHART_TYPES);

export const wordCloudConfigSchema = z
  .object({
    maxWords: z.number().int().min(1).max(WORD_CLOUD_MAX_WORDS),
    minOccurrence: z.number().int().min(1),
    permanentExclusions: z.array(z.string().trim().min(1)).default([]),
    temporaryExclusions: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export const chartFieldMappingSchema = z
  .object({
    role: z.string().min(1),
    conceptKey: z.string().min(1),
  })
  .strict();

export const insightConfigSchema = z
  .object({
    fieldMappings: z.array(chartFieldMappingSchema),
    wordCloud: wordCloudConfigSchema.optional(),
  })
  .strict();

// POST /api/insights
export const createInsightSchema = z
  .object({
    groupId: z.string().min(1),
    projectIds: z.array(z.string().min(1)).default([]),
    name: z.string().trim().min(1).max(INSIGHT_NAME_MAX_LENGTH),
    chartType: chartTypeSchema,
    sourceFilters: filterPanelStateSchema,
    config: insightConfigSchema,
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.chartType !== 'wordCloud' && body.config.wordCloud) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['config', 'wordCloud'],
        message: 'wordCloud config is only valid when chartType is wordCloud',
      });
    }
  });
export type CreateInsightInput = z.infer<typeof createInsightSchema>;

// PUT /api/insights/:id
export const updateInsightSchema = z
  .object({
    name: z.string().trim().min(1).max(INSIGHT_NAME_MAX_LENGTH).optional(),
    chartType: chartTypeSchema.optional(),
    projectIds: z.array(z.string().min(1)).optional(),
    sourceFilters: filterPanelStateSchema.optional(),
    config: insightConfigSchema.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateInsightInput = z.infer<typeof updateInsightSchema>;
