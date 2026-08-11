import { z } from 'zod';

// PUT /api/groups/:groupId/default-query — sets (or clears via null) the default saved
// search a group's members land on for a given project.
export const setGroupDefaultQuerySchema = z
  .object({
    projectId: z.string().min(1),
    savedSearchId: z.string().min(1).nullable(),
  })
  .strict();
export type SetGroupDefaultQueryInput = z.infer<typeof setGroupDefaultQuerySchema>;
