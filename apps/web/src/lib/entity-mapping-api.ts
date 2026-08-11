import type {
  ApiResponse,
  EntityMapping,
  MapEntityMappingEntryInput,
} from '@content-insights/shared';

import { apiClient } from './api-client';

// GET /api/entity-mapping — readable by holders of either entity-mapping:read or
// entity-mapping:manage. See entityMapping.routes.ts's module comment: there's no live
// upstream content-platform integration configured in this environment, so this reconciles
// the org's own Projects/Concepts/Article domains against manually-confirmed mappings
// rather than a real external system.
export async function fetchEntityMapping(): Promise<EntityMapping> {
  const response = await apiClient.get<ApiResponse<EntityMapping>>('/entity-mapping');
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// POST /api/entity-mapping/sync — entity-mapping:manage. Discovers new candidate entries
// from the org's own data; never overwrites an existing mapping decision.
export async function syncEntityMapping(): Promise<EntityMapping> {
  const response = await apiClient.post<ApiResponse<EntityMapping>>('/entity-mapping/sync');
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

// PUT /api/entity-mapping/:entryId — entity-mapping:manage. Pass localId: null to unmap
// an entry back to 'unmapped' (see mapEntityMappingEntrySchema's own comment).
export async function mapEntityMappingEntry(
  entryId: string,
  input: MapEntityMappingEntryInput,
): Promise<EntityMapping> {
  const response = await apiClient.put<ApiResponse<EntityMapping>>(
    `/entity-mapping/${entryId}`,
    input,
  );
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}
