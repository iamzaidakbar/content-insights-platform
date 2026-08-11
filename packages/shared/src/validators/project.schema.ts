import { z } from 'zod';

export const projectSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectInput = z.infer<typeof projectSchema>;

// POST /api/projects
export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).default(''),
  })
  .strict();
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// PUT /api/projects/:id
export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
