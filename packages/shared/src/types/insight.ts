import type { GroupId, InsightId, OrgId, UserId } from '../ids.js';
import type { FilterPanelState } from './search-filters.js';

export const INSIGHT_NAME_MAX_LENGTH = 30;

export const CHART_TYPES = [
  'bar',
  'wordCloud',
  'heatMap',
  'streamChart',
  'treeMap',
  'radar',
  'relationship',
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const WORD_CLOUD_MAX_WORDS = 300;

export interface WordCloudConfig {
  maxWords: number; // <= WORD_CLOUD_MAX_WORDS
  minOccurrence: number;
  permanentExclusions: string[];
  temporaryExclusions: string[];
}

export interface ChartFieldMapping {
  role: string; // chart-specific slot name, e.g. 'category' | 'value' | 'series' | 'x' | 'y' | 'sourceNode' | 'targetNode'
  conceptKey: string;
}

export interface InsightConfig {
  fieldMappings: ChartFieldMapping[];
  wordCloud?: WordCloudConfig | undefined; // only relevant when chartType === 'wordCloud'
}

export interface Insight {
  id: InsightId;
  orgId: OrgId;
  ownerId: UserId;
  ownerEmail: string;
  groupId: GroupId;
  projectIds: string[]; // ProjectId[] as string[]
  name: string; // <= INSIGHT_NAME_MAX_LENGTH, unique per owner
  chartType: ChartType;
  sourceFilters: FilterPanelState; // the Articles result set this insight was built from
  config: InsightConfig;
  createdAt: string;
  updatedAt: string;
}
