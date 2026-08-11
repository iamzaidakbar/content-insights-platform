import { z } from 'zod';

import { CONCEPT_PLACEMENTS } from '../types/concept.js';

export const conceptPlacementSchema = z.enum(CONCEPT_PLACEMENTS);

export const conceptSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  key: z.string().min(1),
  placement: conceptPlacementSchema,
  order: z.number().int().min(0),
  displayLabel: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConceptInput = z.infer<typeof conceptSchema>;

// POST /api/projects/:projectId/concepts — key is derived/validated as a slug since it's
// used directly as the indexed field name.
export const createConceptSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    key: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]+$/, 'key must be a lowercase slug like source_type'),
    placement: conceptPlacementSchema,
    displayLabel: z.string().trim().min(1).max(100),
  })
  .strict();
export type CreateConceptInput = z.infer<typeof createConceptSchema>;

// PUT /api/concepts/:id — key is immutable once created (it's the indexed field name).
export const updateConceptSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    placement: conceptPlacementSchema.optional(),
    order: z.number().int().min(0).optional(),
    displayLabel: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateConceptInput = z.infer<typeof updateConceptSchema>;

// PUT /api/projects/:projectId/concepts/reorder
export const reorderConceptsSchema = z
  .object({
    conceptIds: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type ReorderConceptsInput = z.infer<typeof reorderConceptsSchema>;
