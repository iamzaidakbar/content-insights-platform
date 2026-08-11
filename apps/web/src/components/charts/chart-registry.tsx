import type { ComponentType } from 'react';

import type { ChartType } from '@content-insights/shared';

import BarChart from './BarChart';
import type { ChartSeriesMeta, ChartValueMatrix } from './chart-types';
import HeatMapChart from './HeatMapChart';
import RadarChart from './RadarChart';

export interface ChartPreviewProps {
  categories: string[];
  series: ChartSeriesMeta[];
  values: ChartValueMatrix;
}

// This phase has several agents each building 1-3 of the 7 CHART_TYPES' renderers in
// parallel, without a shared registry file to coordinate through — so lookup goes by the
// filename convention this components/charts directory already established (BarChart.tsx,
// DonutChart.tsx, LineChart.tsx: PascalCase(chartType) + "Chart"). `import.meta.glob` (not a
// static `import`) is what makes this safe before every sibling file lands: an entry that
// doesn't match an existing file is simply absent from `modules` — never a build error —
// so a not-yet-committed chart type degrades to `resolveChartRenderer` returning null
// instead of failing the build. Once a sibling's file is committed under the expected name,
// it starts resolving with no further change needed here.
// One literal-path glob per expected sibling filename (not a broad './*.tsx', and not a
// brace-expansion pattern) — the least ambiguous form of `import.meta.glob`, so this never
// eagerly pulls in unrelated chart files (DonutChart, LineChart, this file itself, ...), and
// each resolves to `{}` rather than a build error for any file not committed yet.
type ChartModule = { default: ComponentType<ChartPreviewProps> };
const modules: Record<string, ChartModule> = {
  ...import.meta.glob<ChartModule>('./WordCloudChart.tsx', { eager: true }),
  ...import.meta.glob<ChartModule>('./StreamChart.tsx', { eager: true }),
  ...import.meta.glob<ChartModule>('./TreeMapChart.tsx', { eager: true }),
  ...import.meta.glob<ChartModule>('./RelationshipChart.tsx', { eager: true }),
};

const OWN_RENDERERS: Partial<Record<ChartType, ComponentType<ChartPreviewProps>>> = {
  bar: BarChart,
  radar: RadarChart,
  heatMap: HeatMapChart,
};

// Expected filenames for the 4 chart types this agent doesn't own. Best-effort: if a
// sibling used a different name, update this map (or ask them to rename) — resolution falls
// back to the "coming online" placeholder either way, it never crashes.
const SIBLING_RENDERER_FILE: Partial<Record<ChartType, string>> = {
  wordCloud: './WordCloudChart.tsx',
  streamChart: './StreamChart.tsx',
  treeMap: './TreeMapChart.tsx',
  relationship: './RelationshipChart.tsx',
};

export function resolveChartRenderer(chartType: ChartType): ComponentType<ChartPreviewProps> | null {
  const own = OWN_RENDERERS[chartType];
  if (own) {
    return own;
  }
  const filename = SIBLING_RENDERER_FILE[chartType];
  if (!filename) {
    return null;
  }
  const module = modules[filename];
  return module?.default ?? null;
}
