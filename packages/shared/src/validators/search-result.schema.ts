import { z } from 'zod';

import { SEARCH_SORT_OPTIONS } from '../types/search-result.js';
import { filterPanelStateSchema } from './search-filters.schema.js';

export const searchSortOptionSchema = z.enum(SEARCH_SORT_OPTIONS);

// POST /api/search
export const searchRequestSchema = z
  .object({
    filters: filterPanelStateSchema,
    page: z.number().int().min(1),
    size: z.number().int().min(1).max(50),
  })
  .strict();
export type SearchRequestInput = z.infer<typeof searchRequestSchema>;

// POST /api/search/facets
export const facetsRequestSchema = z
  .object({
    filters: filterPanelStateSchema,
  })
  .strict();
export type FacetsRequestInput = z.infer<typeof facetsRequestSchema>;
