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
export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    // Empty string clears the domain (disables SSO auto-provisioning for this org).
    ssoDomain: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^([a-z0-9-]+\.)+[a-z]{2,}$/, 'ssoDomain must be a bare domain like acme.com')
      .or(z.literal(''))
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
