import type { FilterPanelState } from './search-filters.js';

export interface TermsAggregationSpec {
  name: string; // caller-chosen bucket label, echoed back — lets one request carry several aggs
  type: 'terms';
  conceptKey: string;
  size?: number; // default 10, max 50
}

export interface DateHistogramAggregationSpec {
  name: string;
  type: 'dateHistogram';
  field: 'publishedAt';
  interval: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

export type AggregationSpec = TermsAggregationSpec | DateHistogramAggregationSpec;

export interface AggregationBucket {
  key: string;
  count: number;
}

export interface AggregationResult {
  name: string;
  buckets: AggregationBucket[];
}

export interface AggregateSearchRequest {
  filters: FilterPanelState;
  aggregations: AggregationSpec[];
}

export interface AggregateSearchResponse {
  total: number; // powers stat-tile widgets directly
  aggregations: AggregationResult[]; // same order as the request
  took: number;
}
