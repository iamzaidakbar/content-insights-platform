import { z } from 'zod';

import { ARTICLE_ASSET_KINDS, ARTICLE_BULK_ACTIONS, ARTICLE_SOURCE_TYPES } from '../types/article.js';

export const articleSourceTypeSchema = z.enum(ARTICLE_SOURCE_TYPES);
export const articleAssetKindSchema = z.enum(ARTICLE_ASSET_KINDS);

export const articleAssetSchema = z.object({
  kind: articleAssetKindSchema,
  url: z.string().min(1),
  fileSizeBytes: z.number().int().nonnegative().optional(),
});

export const articleSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  body: z.string(),
  url: z.string().min(1).optional(),
  domain: z.string().min(1),
  sourceType: articleSourceTypeSchema,
  publishedAt: z.string(),
  authors: z.array(z.string()),
  taxonomyValues: z.record(z.array(z.string())),
  tagIds: z.array(z.string()),
  assets: z.array(articleAssetSchema),
  locationHash: z.string().min(1),
  hidden: z.boolean(),
  hiddenAt: z.string().nullable().optional(),
  hiddenBy: z.string().min(1).nullable().optional(),
  ingestedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ArticleInput = z.infer<typeof articleSchema>;

// PATCH /api/articles/:id/taxonomy — admin correction of ingested taxonomy values, keyed
// by Concept.key; at least one field must be provided.
export const updateArticleTaxonomySchema = z
  .object({
    taxonomyValues: z.record(z.array(z.string())),
  })
  .strict();
export type UpdateArticleTaxonomyInput = z.infer<typeof updateArticleTaxonomySchema>;

// POST /api/articles/bulk
export const articleBulkActionSchema = z.enum(ARTICLE_BULK_ACTIONS);
export const articleBulkRequestSchema = z
  .object({
    action: articleBulkActionSchema,
    articleIds: z.array(z.string().min(1)).min(1).max(500),
    /** Required for addTags/removeTags. */
    tagIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if ((body.action === 'addTags' || body.action === 'removeTags') && !body.tagIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tagIds'],
        message: 'tagIds is required for tag operations',
      });
    }
  });
export type ArticleBulkRequestInput = z.infer<typeof articleBulkRequestSchema>;
