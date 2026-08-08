import { z } from 'zod';

// Shared by every paginated list route (documents, projects). Coerces the raw query
// string to a number and requires it be a positive integer — previously this was a
// hand-clamped `Number(...)` that silently fell back to page 1 on garbage input; this
// now correctly 400s on a malformed page value instead of masking it.
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;
