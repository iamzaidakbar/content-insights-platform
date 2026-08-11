import type { OrgId, ProjectId } from '../ids.js';

export const SYSTEM_FILTER_KEYS = ['hiddenArticles', 'datePublished', 'project', 'userTags'] as const;
export type SystemFilterKey = (typeof SYSTEM_FILTER_KEYS)[number];

export interface FilterLayoutItem {
  kind: 'system' | 'concept';
  key: string; // SystemFilterKey when kind='system', Concept.key when kind='concept'
  order: number;
  label: string;
}

export interface FilterLayout {
  id: string;
  orgId: OrgId;
  projectId?: ProjectId | null; // null = default layout applied across all projects
  items: FilterLayoutItem[];
  updatedAt: string;
}
