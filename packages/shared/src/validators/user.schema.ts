import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  email: z.string().email(),
  roles: z.array(z.string().min(1)),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type UserInput = z.infer<typeof userSchema>;
