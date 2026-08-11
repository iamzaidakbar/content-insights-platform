import type { ComponentType } from 'react';

import type { AggregationBucket, AggregationResult, ChartType, Insight } from '@content-insights/shared';

// The prop contract every apps/web/src/components/charts/<ChartType>Chart.tsx is expected to
// accept. No such contract existed before this phase, so it's designed here as the smallest
// superset that already satisfies the one sibling-built chart in place at the time of writing
// (BarChart.tsx, which reads `buckets` alone) while giving multi-dimensional chart types
// (heatMap/radar/relationship/treeMap) the full role-named aggregation list they'll need.
// Extra unused props are harmless — a component just destructures whatever it needs.
export interface InsightChartProps {
  insight: Insight;
  total: number;
  buckets: AggregationBucket[]; // aggregations[0]?.buckets ?? [] — the common single-dimension case
  aggregations: AggregationResult[]; // full list, keyed by fieldMapping role — for multi-dimension charts
}

type ChartModule = { default: ComponentType<InsightChartProps> };

// import.meta.glob (NOT a static per-type import) is what lets a chart type whose file
// doesn't exist yet fail at *lookup* time — an absent map entry we handle explicitly below —
// rather than at *build* time, where a literal `import('./WordCloudChart')` for a file that
// doesn't exist yet would break the whole app's compile. Vite only enumerates files present
// on disk when this runs, so it's inherently race-safe against sibling agents still adding
// the other six <ChartType>Chart.tsx files.
const chartModules = import.meta.glob<ChartModule>('../charts/*.tsx');

// 'bar' -> 'BarChart.tsx' (matches the one sibling-built chart already in place), 'wordCloud'
// -> 'WordCloudChart.tsx', 'streamChart' -> 'StreamChart.tsx', etc. — capitalize the first
// letter, then append "Chart" only if the capitalized name doesn't already end with it.
// 'streamChart' is the one CHART_TYPES entry that already contains "Chart" in its own name
// (capitalizes to 'StreamChart'), so blindly appending "Chart.tsx" for every type would look
// up a nonexistent '../charts/StreamChartChart.tsx' and silently fall back to the "isn't
// available yet" placeholder for a chart type that's actually fully implemented.
function chartFileBase(chartType: ChartType): string {
  const capitalized = chartType.charAt(0).toUpperCase() + chartType.slice(1);
  return capitalized.endsWith('Chart') ? capitalized : `${capitalized}Chart`;
}

export function resolveChartLoader(chartType: ChartType): (() => Promise<ChartModule>) | undefined {
  return chartModules[`../charts/${chartFileBase(chartType)}.tsx`];
}
