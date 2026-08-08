import { z } from 'zod';

export const projectMemberSchema = z.object({
  userId: z.string().min(1),
  userEmail: z.string().email(),
  roleId: z.string().min(1),
  roleName: z.string().min(1),
});

export const projectSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  members: z.array(projectMemberSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectInput = z.infer<typeof projectSchema>;

// POST /api/projects
export const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// PUT /api/projects/:id — reject a no-op body
export const updateProjectSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one of name or description must be provided',
  });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// POST /api/projects/:id/members
export const addProjectMemberSchema = z.object({
  userId: z.string().min(1),
  roleId: z.string().min(1),
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
