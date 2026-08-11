import { useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { Waves } from 'lucide-react';

import type { AggregationResult } from '@content-insights/shared';

import { formatBucketDateLabel, formatCompactNumber } from '../../lib/format';
import EmptyState from '../EmptyState';
import ChartDataTable from './ChartDataTable';
import ChartViewToggle from './ChartViewToggle';
import { categoricalColor, MAX_CATEGORICAL_SERIES } from './chart-types';

const OTHER_COLOR = 'var(--chart-other)';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 230;
const PADDING_Y = 12;

type DateHistogramInterval = 'day' | 'week' | 'month' | 'quarter' | 'year';

interface StreamChartProps {
  // One entry per stacked series — the real prop name/shape InsightTile.tsx's chart loader
  // actually passes (`<ChartComponent ... aggregations={data.aggregations} />`, see
  // dashboards/chart-loader.ts's InsightChartProps): today each entry is an independent
  // terms aggregation keyed by field-mapping role; a future joint date-histogram-per-series
  // response would slot in unchanged, since this only assumes "a named set of buckets".
  aggregations?: AggregationResult[] | undefined;
  // Only used to format bucket keys that are actually dates via formatBucketDateLabel.
  // Omit when the x-axis is a plain terms breakdown rather than a date histogram — raw
  // keys are shown as-is in that case.
  interval?: DateHistogramInterval | undefined;
}

interface PreparedSeries {
  name: string;
  color: string;
  values: number[]; // aligned 1:1 with the shared xKeys array, 0-filled where missing
  total: number;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function isDateLike(key: string): boolean {
  return !Number.isNaN(Date.parse(key));
}

// Unions every series' bucket keys into one shared x-domain (sorted chronologically when
// every key parses as a date, else left in first-seen order), 0-fills each series against
// that domain, then folds anything past the categorical ramp into a combined "Other"
// series — the same rank-based fold DonutChart uses.
function prepareSeries(input: AggregationResult[]): { xKeys: string[]; prepared: PreparedSeries[] } {
  const nonEmpty = input.filter((s) => s.buckets.length > 0);

  const seen = new Set<string>();
  const xKeyOrder: string[] = [];
  for (const s of nonEmpty) {
    for (const bucket of s.buckets) {
      if (!seen.has(bucket.key)) {
        seen.add(bucket.key);
        xKeyOrder.push(bucket.key);
      }
    }
  }
  const allDates = xKeyOrder.length > 0 && xKeyOrder.every(isDateLike);
  const xKeys = allDates ? [...xKeyOrder].sort((a, b) => Date.parse(a) - Date.parse(b)) : xKeyOrder;

  const withTotals = nonEmpty
    .map((s) => {
      const byKey = new Map(s.buckets.map((b) => [b.key, b.count]));
      const values = xKeys.map((key) => byKey.get(key) ?? 0);
      return { name: s.name, values, total: values.reduce((sum, v) => sum + v, 0) };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);

  type FoldedSeries = { name: string; values: number[]; total: number; isOther?: boolean };
  let folded: FoldedSeries[];
  if (withTotals.length <= MAX_CATEGORICAL_SERIES) {
    folded = withTotals;
  } else {
    const visible = withTotals.slice(0, MAX_CATEGORICAL_SERIES - 1);
    const rest = withTotals.slice(MAX_CATEGORICAL_SERIES - 1);
    const otherValues = xKeys.map((_, i) => rest.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
    folded = [...visible, { name: 'Other', values: otherValues, total: otherValues.reduce((a, b) => a + b, 0), isOther: true }];
  }

  const prepared: PreparedSeries[] = folded.map((s, index) => ({
    name: s.name,
    values: s.values,
    total: s.total,
    color: s.isOther ? OTHER_COLOR : categoricalColor(index),
  }));

  return { xKeys, prepared };
}

interface Band extends PreparedSeries {
  bottom: number[];
  top: number[];
}

function stackBands(xKeys: string[], prepared: PreparedSeries[]): { bands: Band[]; totalsPerX: number[]; maxTotal: number } {
  const n = xKeys.length;
  const totalsPerX: number[] = new Array(n).fill(0);
  const bands: Band[] = prepared.map((s) => {
    const bottom: number[] = [];
    const top: number[] = [];
    for (let i = 0; i < n; i++) {
      const base = totalsPerX[i] ?? 0;
      bottom.push(base);
      const next = base + (s.values[i] ?? 0);
      top.push(next);
      totalsPerX[i] = next;
    }
    return { ...s, bottom, top };
  });
  const maxTotal = niceMax(Math.max(...totalsPerX, 1));
  return { bands, totalsPerX, maxTotal };
}

// Stacked-area "streamgraph" — zero-baselined rather than a centered/wiggle silhouette:
// per the brief either is an acceptable real implementation, and zero-baselined keeps the
// running total readable straight off the y-axis, which a centered baseline would hide.
// Each band gets a 2px --chart-surface stroke around its own perimeter (never a plain
// border color) — where two bands touch, their strokes together read as the same 2px
// surface gap the skill specifies for stacked segments elsewhere. Canvas chrome (gridline/
// baseline/ink) uses the dedicated --chart-* token set shared with Bar/Radar/HeatMap, not
// the app's ambient tokens — see index.css's comment on --chart-surface.
export default function StreamChart({ aggregations = [], interval }: StreamChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { xKeys, prepared } = useMemo(() => prepareSeries(aggregations), [aggregations]);

  if (xKeys.length === 0 || prepared.length === 0) {
    return <EmptyState icon={Waves} title="No data" description="Nothing matched this widget's query yet." />;
  }

  const formatX = (key: string) => (interval ? formatBucketDateLabel(key, interval) : key);

  const legend = (
    <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-[var(--chart-ink-secondary)]">
      {prepared.map((band) => (
        <li key={band.name} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: band.color }} aria-hidden="true" />
          <span>{band.name}</span>
        </li>
      ))}
    </ul>
  );

  const chart = (
    <div>
      {xKeys.length < 2 ? (
        <SingleColumnFallback prepared={prepared} label={xKeys[0] ? formatX(xKeys[0]) : ''} />
      ) : (
        <StreamArea svgRef={svgRef} xKeys={xKeys} prepared={prepared} formatX={formatX} hoverIndex={hoverIndex} setHoverIndex={setHoverIndex} />
      )}
      {legend}
    </div>
  );

  const totals = xKeys.map((_, i) => prepared.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const table = (
    <ChartDataTable
      categoryHeader={interval ? 'Date' : 'Category'}
      categories={xKeys.map(formatX)}
      series={[...prepared.map((s) => ({ key: s.name, label: s.name })), { key: '__total', label: 'Total' }]}
      values={[...prepared.map((s) => s.values), totals]}
    />
  );

  return <ChartViewToggle ariaLabel="Stream chart" chart={chart} table={table} />;
}

interface StreamAreaProps {
  svgRef: RefObject<SVGSVGElement | null>;
  xKeys: string[];
  prepared: PreparedSeries[];
  formatX: (key: string) => string;
  hoverIndex: number | null;
  setHoverIndex: (index: number | null) => void;
}

function StreamArea({ svgRef, xKeys, prepared, formatX, hoverIndex, setHoverIndex }: StreamAreaProps) {
  const { bands, totalsPerX, maxTotal } = stackBands(xKeys, prepared);
  const n = xKeys.length;
  const plotHeight = VIEW_HEIGHT - PADDING_Y * 2;
  const stepX = n > 1 ? VIEW_WIDTH / (n - 1) : 0;
  const xPositions = xKeys.map((_, i) => i * stepX);
  const yFor = (value: number) => PADDING_Y + plotHeight - (value / maxTotal) * plotHeight;

  function areaPath(band: Band): string {
    const forward = xPositions.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${yFor(band.top[i] ?? 0)}`).join(' ');
    const backward = [...xPositions]
      .map((x, i) => ({ x, y: yFor(band.bottom[i] ?? 0) }))
      .reverse()
      .map((p) => `L${p.x},${p.y}`)
      .join(' ');
    return `${forward} ${backward} Z`;
  }

  function handleMove(event: MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relativeX = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
    let nearest = 0;
    let nearestDistance = Infinity;
    xPositions.forEach((x, index) => {
      const distance = Math.abs(x - relativeX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    });
    setHoverIndex(nearest);
  }

  const scaleX = svgRef.current ? svgRef.current.getBoundingClientRect().width / VIEW_WIDTH : 1;
  const scaleY = svgRef.current ? svgRef.current.getBoundingClientRect().height / VIEW_HEIGHT : 1;
  const hoverX = hoverIndex !== null ? (xPositions[hoverIndex] ?? 0) : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        className="h-56 w-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
        role="img"
        aria-label="Series over time"
      >
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1={0}
            x2={VIEW_WIDTH}
            y1={PADDING_Y + plotHeight * fraction}
            y2={PADDING_Y + plotHeight * fraction}
            stroke={fraction === 1 ? 'var(--chart-baseline)' : 'var(--chart-gridline)'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {bands.map((band) => (
          <path key={band.name} d={areaPath(band)} fill={band.color} stroke="var(--chart-surface)" strokeWidth={2} strokeLinejoin="round" />
        ))}

        {hoverX !== null ? (
          <line x1={hoverX} x2={hoverX} y1={PADDING_Y} y2={VIEW_HEIGHT - PADDING_Y} stroke="var(--chart-baseline)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ) : null}
        {hoverIndex !== null
          ? bands.map((band) => (
              <circle
                key={band.name}
                cx={hoverX ?? 0}
                cy={yFor(band.top[hoverIndex] ?? 0)}
                r={3.5}
                fill={band.color}
                stroke="var(--chart-surface)"
                strokeWidth={1.5}
              />
            ))
          : null}
      </svg>

      <div className="mt-1 flex justify-between text-[10px] text-[var(--chart-ink-muted)]">
        <span>{xKeys[0] ? formatX(xKeys[0]) : ''}</span>
        <span>{xKeys[xKeys.length - 1] ? formatX(xKeys[xKeys.length - 1]!) : ''}</span>
      </div>

      {hoverIndex !== null ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[9rem] rounded-[var(--radius-button)] border border-[var(--chart-gridline)] p-2 text-xs shadow-lg"
          style={{ left: (hoverX ?? 0) * scaleX, top: PADDING_Y * scaleY, transform: 'translate(-50%, -100%)', backgroundColor: 'var(--chart-surface)' }}
          role="tooltip"
        >
          <p className="mb-1 border-b border-[var(--chart-gridline)] pb-1 font-semibold text-[var(--chart-ink-primary)]">
            {xKeys[hoverIndex] ? formatX(xKeys[hoverIndex]!) : ''}
          </p>
          {/* Per the skill's interaction rule: one tooltip lists every series at this x —
              the pointer never has to land on a specific band to read its value. Values
              lead (bold), the series name follows. */}
          <ul className="space-y-0.5">
            {bands.map((band) => (
              <li key={band.name} className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: band.color }} aria-hidden="true" />
                <span className="font-semibold text-[var(--chart-ink-primary)]">{formatCompactNumber(band.values[hoverIndex] ?? 0)}</span>
                <span className="truncate text-[var(--chart-ink-secondary)]">{band.name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 border-t border-[var(--chart-gridline)] pt-1 text-[var(--chart-ink-muted)]">
            Total {formatCompactNumber(totalsPerX[hoverIndex] ?? 0)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

// A single-x-key result (or a "series over time" spec fed just one bucket) has nothing to
// draw an area across — the honest real rendering of that is a single stacked column, not
// a zero-width sliver, so this renders that instead of forcing the area-chart path.
function SingleColumnFallback({ prepared, label }: { prepared: PreparedSeries[]; label: string }) {
  const total = prepared.reduce((sum, s) => sum + s.total, 0);
  return (
    <div className="flex flex-col items-center gap-2 py-2">
      <div className="flex h-48 w-16 flex-col-reverse overflow-hidden rounded-[3px]" style={{ backgroundColor: 'var(--chart-gridline)' }}>
        {prepared.map((s) => (
          <div
            key={s.name}
            className="w-full border-t-2 first:border-t-0"
            style={{ height: total > 0 ? `${(s.total / total) * 100}%` : 0, backgroundColor: s.color, borderColor: 'var(--chart-surface)' }}
            title={`${s.name}: ${formatCompactNumber(s.total)}`}
          />
        ))}
      </div>
      <span className="text-xs text-[var(--chart-ink-secondary)]">{label}</span>
    </div>
  );
}
