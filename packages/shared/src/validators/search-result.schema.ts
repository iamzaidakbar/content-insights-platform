import { z } from 'zod';

import { documentFileTypeSchema } from './document.schema.js';
import { dateRangeFilterSchema } from './search-filters.schema.js';

export const searchRequestSchema = z.object({
  query: z.string().min(1),
  projectIds: z.array(z.string()).optional(),
  fileTypes: z.array(documentFileTypeSchema).optional(),
  dateRange: dateRangeFilterSchema.optional(),
  page: z.number().int().min(1),
  size: z.number().int().min(1).max(50),
});
export type SearchRequestInput = z.infer<typeof searchRequestSchema>;
