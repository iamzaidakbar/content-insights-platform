import { z } from 'zod';

export const dateRangeFilterSchema = z
  .object({
    start: z.string().optional(),
    end: z.string().optional(),
  })
  .strict();

export const articleContentTypeSchema = z.enum(['news', 'document', 'report']);

export const searchFiltersSchema = z
  .object({
    dateRange: dateRangeFilterSchema,
    sources: z.array(z.string()),
    contentType: articleContentTypeSchema.nullable(),
    tags: z.array(z.string()),
    languages: z.array(z.string()),
    projects: z.array(z.string()),
  })
  .strict();
export type SearchFiltersInput = z.infer<typeof searchFiltersSchema>;
