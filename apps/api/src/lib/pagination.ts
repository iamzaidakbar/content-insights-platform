import { z } from 'zod';

// Shared by every paginated list route (documents, projects). Coerces the raw query
// string to a number and requires it be a positive integer — previously this was a
// hand-clamped `Number(...)` that silently fell back to page 1 on garbage input; this
// now correctly 400s on a malformed page value instead of masking it.
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

// Documents listing additionally accepts pageSize, driven by the frontend's
// settings.search.defaultPageSize (see SettingsContext) rather than a hardcoded
// per-page constant — constrained to the same 12/24/48 enum UserSettings uses, so a
// client can never request an arbitrarily large page.
export const documentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce
    .number()
    .int()
    .refine((value) => value === 12 || value === 24 || value === 48, {
      message: 'pageSize must be 12, 24, or 48',
    })
    .optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
