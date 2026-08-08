import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().optional(),
  roles: z.array(z.string().min(1)),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type UserInput = z.infer<typeof userSchema>;

// PATCH /api/users/me — the only field this endpoint updates, so (unlike
// updateProjectSchema's "at least one of" pattern) it's simply required.
export const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
