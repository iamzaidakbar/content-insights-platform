// Shared prop contract for the multi-series SVG chart components (BarChart, RadarChart,
// HeatMapChart) — see the dataviz skill's color-formula.md: categorical color is assigned
// by FIXED slot order (never cycled, never reassigned when a filter changes series count),
// so every series carries a stable `key` used purely for color/identity lookups, kept
// separate from its human-readable `label` (untrusted external text — always inserted via
// JSX text nodes in these components, never innerHTML).
export interface ChartSeriesMeta {
  key: string;
  label: string;
}

// `values[seriesIndex][categoryIndex]` — a plain matrix, not embedded on each series, so a
// caller (e.g. an adapter over InsightDataResponse's independent per-role aggregation
// buckets) can align separately-sourced series without re-shaping them into one object per
// series. A short/missing row or cell reads as 0 via `valueAt` below rather than throwing.
export type ChartValueMatrix = number[][];

export function valueAt(values: ChartValueMatrix, seriesIndex: number, categoryIndex: number): number {
  return values[seriesIndex]?.[categoryIndex] ?? 0;
}

// The dataviz skill's validated 8-hue categorical ramp (references/palette.md) — the app's
// own --chart-1..8 tokens in index.css. Fixed order, assigned by index, NEVER cycled or
// reassigned when a filter changes series count (an entity that drops out of view leaves a
// gap; survivors keep their color — see the skill's "recolor-on-filter" anti-pattern).
export const CATEGORICAL_CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const;
export const MAX_CATEGORICAL_SERIES = CATEGORICAL_CHART_COLORS.length;

// Callers must fold any series beyond the 8th into an "Other" bucket themselves (per the
// skill's anti-patterns: never cycle/generate a 9th hue) — this just clamps defensively so a
// stray 9th series renders in the last slot rather than crashing.
export function categoricalColor(index: number): string {
  const clamped = Math.min(Math.max(index, 0), MAX_CATEGORICAL_SERIES - 1);
  return CATEGORICAL_CHART_COLORS[clamped] ?? CATEGORICAL_CHART_COLORS[0];
}

// Sequential single-hue ramp (light -> dark) for magnitude — HeatMapChart's cell fill.
// Theme-invariant (see index.css's own comment on --chart-seq-100..700).
export const SEQUENTIAL_CHART_STEPS = [
  'var(--chart-seq-100)',
  'var(--chart-seq-200)',
  'var(--chart-seq-300)',
  'var(--chart-seq-400)',
  'var(--chart-seq-500)',
  'var(--chart-seq-600)',
  'var(--chart-seq-700)',
] as const;

// Quantizes a 0..1 fraction of the domain max into one of the 7 sequential steps (lightest
// = near-zero, darkest = max). `t <= 0` (no data / exactly zero) is the caller's cue to
// render an empty cell instead of this ramp's lightest step — see HeatMapChart.
export function sequentialStep(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const index = Math.min(SEQUENTIAL_CHART_STEPS.length - 1, Math.floor(clamped * SEQUENTIAL_CHART_STEPS.length));
  return SEQUENTIAL_CHART_STEPS[index] ?? SEQUENTIAL_CHART_STEPS[0];
}
