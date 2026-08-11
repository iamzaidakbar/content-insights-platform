import { z } from 'zod';

import { filterPanelStateSchema } from './search-filters.schema.js';

const termsAggregationSpecSchema = z.object({
  name: z.string().min(1),
  type: z.literal('terms'),
  conceptKey: z.string().min(1),
  size: z.number().int().min(1).max(50).optional(),
});

const dateHistogramAggregationSpecSchema = z.object({
  name: z.string().min(1),
  type: z.literal('dateHistogram'),
  field: z.literal('publishedAt'),
  interval: z.enum(['day', 'week', 'month', 'quarter', 'year']),
});

export const aggregationSpecSchema = z.discriminatedUnion('type', [
  termsAggregationSpecSchema,
  dateHistogramAggregationSpecSchema,
]);
export type AggregationSpecInput = z.infer<typeof aggregationSpecSchema>;

// POST /api/search/aggregate — internal endpoint used to fetch chart data for Insights.
export const aggregateSearchRequestSchema = z
  .object({
    filters: filterPanelStateSchema,
    aggregations: z.array(aggregationSpecSchema).min(0).max(10),
  })
  .strict();
export type AggregateSearchRequestInput = z.infer<typeof aggregateSearchRequestSchema>;
