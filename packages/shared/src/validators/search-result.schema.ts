import { z } from 'zod';

import { documentFileTypeSchema } from './document.schema.js';

export const searchRequestSchema = z.object({
  query: z.string().min(1),
  projectIds: z.array(z.string()).optional(),
  fileTypes: z.array(documentFileTypeSchema).optional(),
  page: z.number().int().min(1),
  size: z.number().int().min(1).max(50),
});
export type SearchRequestInput = z.infer<typeof searchRequestSchema>;
