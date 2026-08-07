import { z } from 'zod';

export const searchResultSchema = z.object({
  documentId: z.string().min(1),
  orgId: z.string().min(1),
  title: z.string().min(1),
  snippet: z.string(),
  score: z.number().min(0),
});

export type SearchResultInput = z.infer<typeof searchResultSchema>;
