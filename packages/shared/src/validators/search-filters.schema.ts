import { z } from 'zod';

import { SEARCH_SORT_OPTIONS } from '../types/search-result.js';
import {
  ADVANCED_CONDITION_MODES,
  BOOLEAN_OPERATORS,
  DATE_FILTER_MODES,
  FACET_SORT_ORDERS,
  HIDDEN_ARTICLES_MODES,
  SOURCE_TYPE_TABS,
  TAXONOMY_MATCH_LOGICS,
} from '../types/search-filters.js';

export const dateFilterModeSchema = z.enum(DATE_FILTER_MODES);

export const dateFilterValueSchema = z
  .object({
    mode: dateFilterModeSchema,
    start: z.string().min(1).nullable().optional(),
    end: z.string().min(1).nullable().optional(),
    lastNDays: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'lastNDays' && !value.lastNDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lastNDays'],
        message: 'lastNDays is required when mode is lastNDays',
      });
    }
    if (value.mode !== 'between' && value.end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: 'end is only valid when mode is between',
      });
    }
  });
export type DateFilterValueInput = z.infer<typeof dateFilterValueSchema>;

export const taxonomyMatchLogicSchema = z.enum(TAXONOMY_MATCH_LOGICS);
export const advancedConditionModeSchema = z.enum(ADVANCED_CONDITION_MODES);
export const booleanOperatorSchema = z.enum(BOOLEAN_OPERATORS);

export const advancedSearchConditionSchema = z
  .object({
    id: z.string().min(1),
    mode: advancedConditionModeSchema,
    conceptKey: z.string().min(1).optional(),
    conceptKeys: z.array(z.string().min(1)).optional(),
    values: z.array(z.string()),
    matchLogic: taxonomyMatchLogicSchema,
    operatorToNext: booleanOperatorSchema,
  })
  .strict()
  .superRefine((condition, ctx) => {
    if (condition.mode === 'taxonomy' && !condition.conceptKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conceptKey'],
        message: 'conceptKey is required when mode is taxonomy',
      });
    }
    if (condition.mode === 'crossConcept' && !condition.conceptKeys?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conceptKeys'],
        message: 'conceptKeys is required when mode is crossConcept',
      });
    }
  });

export const advancedSearchGroupSchema = z
  .object({
    id: z.string().min(1),
    conditions: z.array(advancedSearchConditionSchema).min(1),
    operatorToNext: booleanOperatorSchema,
  })
  .strict();

export const advancedSearchSchema = z
  .object({
    enabled: z.boolean(),
    groups: z.array(advancedSearchGroupSchema),
  })
  .strict();
export type AdvancedSearchInput = z.infer<typeof advancedSearchSchema>;

export const sourceTypeTabSchema = z.enum(SOURCE_TYPE_TABS);
export const facetSortOrderSchema = z.enum(FACET_SORT_ORDERS);
export const hiddenArticlesModeSchema = z.enum(HIDDEN_ARTICLES_MODES);

// The full active-filter shape shared by the Filter Panel, Advanced Search, saved searches,
// and insights — one schema for all of them so persisting/restoring never has to translate
// between slightly different shapes.
export const filterPanelStateSchema = z
  .object({
    query: z.string(),
    sourceTypeTab: sourceTypeTabSchema,
    hiddenArticles: hiddenArticlesModeSchema,
    dateFilter: dateFilterValueSchema.nullable(),
    projectIds: z.array(z.string().min(1)),
    taxonomyValues: z.record(z.array(z.string())),
    userTagIds: z.array(z.string().min(1)),
    advancedSearch: advancedSearchSchema,
    sort: z.enum(SEARCH_SORT_OPTIONS),
  })
  .strict();
export type FilterPanelStateInput = z.infer<typeof filterPanelStateSchema>;
