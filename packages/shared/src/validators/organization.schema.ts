import { z } from 'zod';

export const organizationPlanSchema = z.enum(['free', 'pro', 'enterprise']);

export const organizationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  plan: organizationPlanSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type OrganizationInput = z.infer<typeof organizationSchema>;
