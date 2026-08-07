import { z } from 'zod';

export const roleSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1),
  permissions: z.array(z.string().min(1)),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RoleInput = z.infer<typeof roleSchema>;
