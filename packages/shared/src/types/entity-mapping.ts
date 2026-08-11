import type { EntityMappingId, OrgId } from '../ids.js';

export const UPSTREAM_ENTITY_TYPES = ['project', 'concept', 'source'] as const;
export type UpstreamEntityType = (typeof UPSTREAM_ENTITY_TYPES)[number];

export const ENTITY_MAPPING_STATUSES = ['unmapped', 'mapped', 'conflict'] as const;
export type EntityMappingStatus = (typeof ENTITY_MAPPING_STATUSES)[number];

export interface EntityMappingEntry {
  id: string;
  upstreamType: UpstreamEntityType;
  upstreamId: string;
  upstreamName: string;
  localType: UpstreamEntityType;
  localId: string | null;
  localName?: string | null;
  lastSyncedAt: string | null;
  status: EntityMappingStatus;
}

export interface EntityMapping {
  id: EntityMappingId;
  orgId: OrgId;
  upstreamSystem: string;
  entries: EntityMappingEntry[];
  updatedAt: string;
}
