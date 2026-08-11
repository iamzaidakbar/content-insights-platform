import { BarChart3, Boxes, Cloud, Grid3x3, Network, Radar, Waves, type LucideIcon } from 'lucide-react';

import { CHART_TYPES, type ChartType } from '@content-insights/shared';

export interface ChartTypeMeta {
  label: string;
  description: string;
  icon: LucideIcon;
}

// Display metadata for the chart-type picker — every one of the 7 CHART_TYPES always shows
// up here (the picker itself never depends on whether a renderer file exists yet); only the
// *preview* step (chart-registry.tsx) needs to know which renderers are actually available.
export const CHART_TYPE_META: Record<ChartType, ChartTypeMeta> = {
  bar: { label: 'Bar', description: 'Compare counts across categories.', icon: BarChart3 },
  radar: { label: 'Radar', description: 'Compare several categories on one shared scale.', icon: Radar },
  heatMap: { label: 'Heat map', description: 'Magnitude across two categorical axes.', icon: Grid3x3 },
  wordCloud: { label: 'Word cloud', description: 'Frequency of words across matching articles.', icon: Cloud },
  streamChart: { label: 'Stream', description: 'A flowing view of a series over time.', icon: Waves },
  treeMap: { label: 'Tree map', description: 'Part-to-whole across nested categories.', icon: Boxes },
  relationship: { label: 'Relationship', description: 'Connections between two entities.', icon: Network },
};

export interface ChartFieldSlot {
  role: string; // matches ChartFieldMapping.role
  label: string;
  required: boolean;
}

// The mapping slots each chart type exposes in the builder's field-assignment step. `role`
// is an opaque string as far as the shared contract goes (ChartFieldMapping.role's own
// comment lists these exact names as examples) — this table is the frontend's own
// vocabulary for what each chart type's slots mean, since insight.routes.ts's GET /:id/data
// treats every mapping as an independent terms aggregation regardless of chart type.
// wordCloud has no field-mapping slots at all — it's driven by config.wordCloud instead.
export const CHART_FIELD_SLOTS: Record<ChartType, ChartFieldSlot[]> = {
  bar: [
    { role: 'category', label: 'Category', required: true },
    { role: 'series', label: 'Compare by (optional)', required: false },
  ],
  radar: [
    { role: 'category', label: 'Axis', required: true },
    { role: 'series', label: 'Compare by (optional)', required: false },
  ],
  heatMap: [
    { role: 'x', label: 'Columns', required: true },
    { role: 'y', label: 'Rows', required: true },
  ],
  treeMap: [
    { role: 'category', label: 'Category', required: true },
    { role: 'series', label: 'Group by (optional)', required: false },
  ],
  streamChart: [
    { role: 'x', label: 'Category', required: true },
    { role: 'series', label: 'Compare by (optional)', required: false },
  ],
  relationship: [
    { role: 'sourceNode', label: 'Source', required: true },
    { role: 'targetNode', label: 'Target', required: true },
  ],
  wordCloud: [],
};

export function isRoleSatisfied(slots: ChartFieldSlot[], fieldMappings: { role: string }[]): boolean {
  const mappedRoles = new Set(fieldMappings.map((mapping) => mapping.role));
  return slots.filter((slot) => slot.required).every((slot) => mappedRoles.has(slot.role));
}

export { CHART_TYPES };
