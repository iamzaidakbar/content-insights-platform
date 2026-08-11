import { z } from 'zod';

import { SYSTEM_FILTER_KEYS } from '../types/filter-layout.js';

const filterLayoutItemSchema = z
  .object({
    kind: z.enum(['system', 'concept']),
    key: z.string().min(1),
    order: z.number().int().min(0),
    label: z.string().trim().min(1).max(100),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.kind === 'system' && !(SYSTEM_FILTER_KEYS as readonly string[]).includes(item.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['key'],
        message: `key must be one of ${SYSTEM_FILTER_KEYS.join(', ')} when kind is system`,
      });
    }
  });
export type FilterLayoutItemInput = z.infer<typeof filterLayoutItemSchema>;

// PUT /api/filter-layout — admin-configured LHS placement/order/labels; projectId null
// (or omitted) targets the org-wide default layout applied across all projects.
export const updateFilterLayoutSchema = z
  .object({
    projectId: z.string().min(1).nullable().optional(),
    items: z.array(filterLayoutItemSchema),
  })
  .strict();
export type UpdateFilterLayoutInput = z.infer<typeof updateFilterLayoutSchema>;
