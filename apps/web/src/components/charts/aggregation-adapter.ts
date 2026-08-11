import type { AggregationResult } from '@content-insights/shared';

import type { ChartSeriesMeta, ChartValueMatrix } from './chart-types';

export interface AdaptedChartData {
  categories: string[];
  series: ChartSeriesMeta[];
  values: ChartValueMatrix;
}

// GET /api/insights/:id/data returns one INDEPENDENT terms aggregation per configured
// field-mapping role (see insight.routes.ts's own comment on that route) — never a joint
// cross-tabulation. For the common single-mapping case (one aggregation) that's exactly
// right: its own buckets ARE the categories, one series. With 2+ mappings there is no real
// joint count to show, so this treats the FIRST aggregation's bucket keys as the shared
// category axis and every aggregation (including the first) as its own independent series,
// looking up each category's count within that aggregation's own top-N buckets (0 if a key
// doesn't appear there) — an honest "here's what we independently know," never a fabricated
// joint value (see RelationshipChart.tsx's identical stance on the same backend gap).
export function adaptAggregationsToSeries(aggregations: AggregationResult[]): AdaptedChartData {
  const [first, ...rest] = aggregations;
  if (!first) {
    return { categories: [], series: [], values: [] };
  }
  const categories = first.buckets.map((bucket) => bucket.key);
  const allAggregations = [first, ...rest];
  const series: ChartSeriesMeta[] = allAggregations.map((agg) => ({ key: agg.name, label: agg.name }));
  const values: ChartValueMatrix = allAggregations.map((agg) => {
    const countByKey = new Map(agg.buckets.map((bucket) => [bucket.key, bucket.count]));
    return categories.map((category) => countByKey.get(category) ?? 0);
  });
  return { categories, series, values };
}
