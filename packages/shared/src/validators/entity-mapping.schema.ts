import { z } from 'zod';

import { ENTITY_MAPPING_STATUSES, UPSTREAM_ENTITY_TYPES } from '../types/entity-mapping.js';

export const upstreamEntityTypeSchema = z.enum(UPSTREAM_ENTITY_TYPES);
export const entityMappingStatusSchema = z.enum(ENTITY_MAPPING_STATUSES);

// PUT /api/entity-mapping/:upstreamSystem/entries/:entryId — map (or unmap, via null) one
// upstream entity to a local one. entity-mapping:manage.
export const mapEntityMappingEntrySchema = z
  .object({
    localType: upstreamEntityTypeSchema,
    localId: z.string().min(1).nullable(),
  })
  .strict();
export type MapEntityMappingEntryInput = z.infer<typeof mapEntityMappingEntrySchema>;
