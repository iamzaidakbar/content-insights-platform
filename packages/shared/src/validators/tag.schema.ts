import { z } from 'zod';

export const tagSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1),
  count: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TagInput = z.infer<typeof tagSchema>;

// POST /api/tags — orgId is deliberately absent here (unlike the literal spec's body
// shape) and taken from req.user.orgId server-side instead, matching every other
// org-scoped create route in this codebase (createProjectSchema, createRoleSchema, ...)
// never trusting a client-supplied orgId.
export const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a hex value like #6c63ff'),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;
