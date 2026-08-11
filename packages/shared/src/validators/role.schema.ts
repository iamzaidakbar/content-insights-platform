import { z } from 'zod';

import { PERMISSIONS } from '../permissions.js';

export const roleSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1),
  permissions: z.array(z.string().min(1)),
  isSystem: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RoleInput = z.infer<typeof roleSchema>;

// Role-creation input only — constrained to the fixed permission catalog (plus the '*'
// wildcard) so a typo'd permission string can never silently create a role that never
// matches any requirePermission() check. The entity schema above stays loose.
const permissionValueSchema = z.union([z.literal('*'), z.enum(PERMISSIONS)]);

// isSystem is deliberately absent — always false for user-created roles, set server-side.
export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  permissions: z.array(permissionValueSchema).min(1),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

// PUT /api/roles/:id
export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    permissions: z.array(permissionValueSchema).min(1).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one of name or permissions must be provided',
  });
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
