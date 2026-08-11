import type { ConceptId, OrgId, ProjectId } from '../ids.js';

export const CONCEPT_PLACEMENTS = ['hard', 'soft'] as const;
export type ConceptPlacement = (typeof CONCEPT_PLACEMENTS)[number];

export interface Concept {
  id: ConceptId;
  orgId: OrgId;
  projectId: ProjectId;
  name: string; // unique per project, case-insensitive
  key: string; // slug, used as the indexed field name
  placement: ConceptPlacement;
  order: number;
  displayLabel: string;
  createdAt: string;
  updatedAt: string;
}
