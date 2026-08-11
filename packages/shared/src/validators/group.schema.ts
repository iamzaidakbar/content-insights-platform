import { z } from 'zod';

export const hardFilterGrantSchema = z
  .object({
    conceptId: z.string().min(1),
    conceptName: z.string().min(1),
    allowedValues: z.array(z.string().min(1)),
    denialNote: z.string().trim().max(500).optional(),
  })
  .strict();
export type HardFilterGrantInput = z.infer<typeof hardFilterGrantSchema>;

export const softFilterConceptGrantSchema = z
  .object({
    conceptId: z.string().min(1),
    conceptName: z.string().min(1),
    order: z.number().int().min(0),
  })
  .strict();
export type SoftFilterConceptGrantInput = z.infer<typeof softFilterConceptGrantSchema>;

export const groupDataAccessSchema = z
  .object({
    projectIds: z.array(z.string().min(1)),
    hardFilterGrants: z.array(hardFilterGrantSchema),
    softFilterConcepts: z.array(softFilterConceptGrantSchema),
  })
  .strict();
export type GroupDataAccessInput = z.infer<typeof groupDataAccessSchema>;

export const groupMemberSummarySchema = z.object({
  userId: z.string().min(1),
  userEmail: z.string().email(),
  roleId: z.string().min(1),
  roleName: z.string().min(1),
  startDate: z.string().min(1).nullable().optional(),
  endDate: z.string().min(1).nullable().optional(),
});

export const groupSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  dataAccess: groupDataAccessSchema,
  members: z.array(groupMemberSummarySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GroupInput = z.infer<typeof groupSchema>;

// POST /api/groups — dataAccess starts empty and is configured afterward via
// PUT /api/groups/:id/data-access (groups:manageDataAccess); members are never posted
// directly here since Group.members is a derived read-model, not a stored field.
export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

// PUT /api/groups/:id — reject a no-op body
export const updateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one of name or description must be provided',
  });
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

// PUT /api/groups/:id/data-access — groups:manageDataAccess is a separate permission from
// groups:manage, so this is its own route/schema rather than folded into updateGroupSchema.
export const updateGroupDataAccessSchema = groupDataAccessSchema;
export type UpdateGroupDataAccessInput = z.infer<typeof updateGroupDataAccessSchema>;

// The three data-access sub-resource endpoints below each replace one slice of
// GroupDataAccess independently (see updateGroupDataAccessSchema's own comment on why
// data access is split from container CRUD in the first place) — reusing the exact same
// per-item schemas as groupDataAccessSchema rather than re-declaring their fields.

// PUT /api/groups/:id/data-access/projects
export const updateGroupProjectsSchema = z
  .object({ projectIds: z.array(z.string().min(1)) })
  .strict();
export type UpdateGroupProjectsInput = z.infer<typeof updateGroupProjectsSchema>;

// PUT /api/groups/:id/data-access/hard-filters
export const updateGroupHardFiltersSchema = z
  .object({ hardFilterGrants: z.array(hardFilterGrantSchema) })
  .strict();
export type UpdateGroupHardFiltersInput = z.infer<typeof updateGroupHardFiltersSchema>;

// PUT /api/groups/:id/data-access/soft-filters
export const updateGroupSoftFiltersSchema = z
  .object({ softFilterConcepts: z.array(softFilterConceptGrantSchema) })
  .strict();
export type UpdateGroupSoftFiltersInput = z.infer<typeof updateGroupSoftFiltersSchema>;
