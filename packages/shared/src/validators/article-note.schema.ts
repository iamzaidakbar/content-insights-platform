import { z } from 'zod';

import { ARTICLE_NOTE_BODY_MAX_LENGTH, ARTICLE_NOTE_VISIBILITIES } from '../types/article-note.js';

export const articleNoteVisibilitySchema = z.enum(ARTICLE_NOTE_VISIBILITIES);

export const createArticleNoteSchema = z
  .object({
    body: z.string().trim().min(1).max(ARTICLE_NOTE_BODY_MAX_LENGTH),
    visibility: articleNoteVisibilitySchema,
    groupId: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.visibility === 'group' && !body.groupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groupId'],
        message: 'groupId is required when visibility is group',
      });
    }
    if (body.visibility === 'private' && body.groupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groupId'],
        message: 'groupId is only valid when visibility is group',
      });
    }
  });
export type CreateArticleNoteInput = z.infer<typeof createArticleNoteSchema>;

export const updateArticleNoteSchema = z
  .object({
    body: z.string().trim().min(1).max(ARTICLE_NOTE_BODY_MAX_LENGTH).optional(),
    visibility: articleNoteVisibilitySchema.optional(),
    groupId: z.string().min(1).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  })
  .superRefine((body, ctx) => {
    const visibility = body.visibility;
    if (visibility === 'group' && !body.groupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groupId'],
        message: 'groupId is required when visibility is group',
      });
    }
    if (visibility === 'private' && body.groupId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['groupId'],
        message: 'groupId is only valid when visibility is group',
      });
    }
  });
export type UpdateArticleNoteInput = z.infer<typeof updateArticleNoteSchema>;
