import type {
  ApiResponse,
  Concept,
  CreateConceptInput,
  FacetBucket,
  UpdateConceptInput,
} from '@content-insights/shared';

import { apiClient } from './api-client';

// Router is mounted flatly at /api/concepts (not nested under /api/projects/:projectId) —
// the owning project is carried as a `projectId` query param on both list and create,
// matching concept.routes.ts exactly.

export async function fetchConcepts(projectId: string): Promise<Concept[]> {
  const response = await apiClient.get<ApiResponse<Concept[]>>('/concepts', {
    params: { projectId },
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function fetchConceptsForProjects(projectIds: string[]): Promise<Concept[]> {
  if (projectIds.length === 0) {
    return [];
  }
  const pages = await Promise.all(projectIds.map((projectId) => fetchConcepts(projectId)));
  const byId = new Map<string, Concept>();
  for (const concept of pages.flat()) {
    byId.set(concept.id, concept);
  }
  return [...byId.values()];
}

export async function createConcept(projectId: string, input: CreateConceptInput): Promise<Concept> {
  const response = await apiClient.post<ApiResponse<Concept>>('/concepts', input, {
    params: { projectId },
  });
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function updateConcept(id: string, input: UpdateConceptInput): Promise<Concept> {
  const response = await apiClient.put<ApiResponse<Concept>>(`/concepts/${id}`, input);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data;
}

export async function deleteConcept(id: string): Promise<void> {
  const response = await apiClient.delete<ApiResponse<null>>(`/concepts/${id}`);
  if (!response.data.success) {
    throw new Error(response.data.message);
  }
}

interface ConceptValuesResponse {
  values: FacetBucket[];
}

// The full raw universe of indexed values for this concept's key, unfiltered by any
// group's hard-filter grant — powers the admin hard-filter-grant picker. Gated server-side
// on concepts:manage or groups:manageDataAccess; never call this for an ordinary searcher's
// filter panel (that uses fetchSearchFacets instead).
export async function fetchConceptValues(id: string): Promise<FacetBucket[]> {
  const response = await apiClient.get<ApiResponse<ConceptValuesResponse>>(`/concepts/${id}/values`);
  const body = response.data;
  if (!body.success) {
    throw new Error(body.message);
  }
  return body.data.values;
}
