import { z } from 'zod';

export const roleAssignmentSchema = z.object({
  id: z.string().min(1),
  roleId: z.string().min(1),
  roleName: z.string().min(1),
  groupId: z.string().min(1).nullable(),
  groupName: z.string().min(1).nullable().optional(),
  startDate: z.string().min(1).nullable().optional(),
  endDate: z.string().min(1).nullable().optional(),
});
export type RoleAssignmentInput = z.infer<typeof roleAssignmentSchema>;

export const userSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().optional(),
  isActive: z.boolean(),
  roleAssignments: z.array(roleAssignmentSchema),
  currentGroupId: z.string().min(1).nullable().optional(),
  currentProjectId: z.string().min(1).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserInput = z.infer<typeof userSchema>;

// PATCH /api/users/me — the only field this endpoint updates, so it's simply required.
export const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// POST /api/users (users:manage) — creates a new User directly in the caller's org. No
// `password` field: a secure temporary password is generated server-side and returned once
// in the response body (see CreateUserResult) rather than emailed, since this app has no
// outbound email/SMTP integration.
export const createUserSchema = z
  .object({
    email: z.string().email(),
    displayName: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
export type CreateUserInput = z.infer<typeof createUserSchema>;

// POST /api/users/:id/role-assignments — groupId null assigns the "All" (global) scope.
// Application Admin assignments must never carry startDate/endDate; that restriction is
// enforced in application code (it depends on which role the roleId resolves to), not here.
export const assignUserRoleSchema = z
  .object({
    roleId: z.string().min(1),
    groupId: z.string().min(1).nullable(),
    startDate: z.string().min(1).nullable().optional(),
    endDate: z.string().min(1).nullable().optional(),
  })
  .strict();
export type AssignUserRoleInput = z.infer<typeof assignUserRoleSchema>;

// PATCH /api/users/me/current-group — last-selected navbar group; null clears it.
export const setCurrentGroupSchema = z
  .object({
    groupId: z.string().min(1).nullable(),
  })
  .strict();
export type SetCurrentGroupInput = z.infer<typeof setCurrentGroupSchema>;

// PATCH /api/users/me/current-project
export const setCurrentProjectSchema = z
  .object({
    projectId: z.string().min(1).nullable(),
  })
  .strict();
export type SetCurrentProjectInput = z.infer<typeof setCurrentProjectSchema>;

// PATCH /api/users/:id/status — activate/deactivate a user (users:manage).
export const setUserActiveSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();
export type SetUserActiveInput = z.infer<typeof setUserActiveSchema>;

// PATCH /api/users/:id/role-assignments/:assignmentId — "end" (or reschedule the end of)
// an existing assignment. Only endDate is mutable this way; changing roleId/groupId means
// removing this assignment (DELETE) and creating a new one (POST) instead.
export const updateRoleAssignmentEndDateSchema = z
  .object({
    endDate: z.string().min(1).nullable(),
  })
  .strict();
export type UpdateRoleAssignmentEndDateInput = z.infer<typeof updateRoleAssignmentEndDateSchema>;
