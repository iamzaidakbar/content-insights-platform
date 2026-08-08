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

// PATCH /api/organizations/:orgId
export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
