import { z } from 'zod';

import { USER_TAG_NAME_MAX_LENGTH } from '../types/user-tag.js';

export const userTagShareGrantSchema = z
  .object({
    groupId: z.string().min(1),
    groupName: z.string().min(1),
    canUse: z.boolean(),
    canDelete: z.boolean(),
  })
  .strict();
export type UserTagShareGrantInput = z.infer<typeof userTagShareGrantSchema>;

export const userTagSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().trim().min(1).max(USER_TAG_NAME_MAX_LENGTH),
  ownerGroupId: z.string().min(1),
  ownerGroupName: z.string().min(1),
  isPrivate: z.boolean(),
  isPublished: z.boolean(),
  createdBy: z.string().min(1),
  sharedWithGroups: z.array(userTagShareGrantSchema),
  articleCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserTagInput = z.infer<typeof userTagSchema>;

// POST /api/user-tags — ownerGroupId is deliberately absent (taken from the user's
// currentGroupId server-side), matching every other org-scoped create route in this
// codebase (createRoleSchema, createGroupSchema, ...) never trusting a client-supplied id.
export const createUserTagSchema = z
  .object({
    name: z.string().trim().min(1).max(USER_TAG_NAME_MAX_LENGTH),
    isPrivate: z.boolean().default(false),
  })
  .strict();
export type CreateUserTagInput = z.infer<typeof createUserTagSchema>;

// PATCH /api/user-tags/:id
export const updateUserTagSchema = z
  .object({
    name: z.string().trim().min(1).max(USER_TAG_NAME_MAX_LENGTH).optional(),
    isPrivate: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateUserTagInput = z.infer<typeof updateUserTagSchema>;

// POST /api/user-tags/:id/share — user-tags:shareIntoGroups
export const shareUserTagSchema = z
  .object({
    grants: z
      .array(
        z
          .object({
            groupId: z.string().min(1),
            canUse: z.boolean(),
            canDelete: z.boolean(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type ShareUserTagInput = z.infer<typeof shareUserTagSchema>;
