import { useMemo, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { BarChart3 } from 'lucide-react';

import type { AggregationBucket, AggregationResult, Insight } from '@content-insights/shared';

import { formatCompactNumber } from '../../lib/format';
import EmptyState from '../EmptyState';
import { adaptAggregationsToSeries } from './aggregation-adapter';
import ChartDataTable from './ChartDataTable';
import ChartTooltip from './ChartTooltip';
import ChartViewToggle from './ChartViewToggle';
import { categoricalColor, valueAt, type ChartSeriesMeta, type ChartValueMatrix } from './chart-types';

const VIEW_WIDTH = 600;
const LABEL_WIDTH = 132;
const LABEL_GAP = 10;
const RIGHT_PADDING = 44;
const PLOT_LEFT = LABEL_WIDTH + LABEL_GAP;
const PLOT_WIDTH = VIEW_WIDTH - PLOT_LEFT - RIGHT_PADDING;
const TOP_PADDING = 20; // room for the top axis-tick row
const GROUP_GAP = 12; // air between category groups
const BAR_GAP = 2; // the mark spec's 2px surface gap between touching marks
const BAR_RADIUS = 4;
const MAX_LABELED_MARKS = 12; // "label selectively — never a number on every point/bar"

// This repo's own low-level contract — categories/series/values, used directly by
// InsightBuilderModal's illustrative preview (no live Insight/aggregations exist yet at
// that point in the flow).
export interface BarChartOwnProps {
  categories: string[];
  series: ChartSeriesMeta[];
  values: ChartValueMatrix;
  valueFormatter?: ((value: number) => string) | undefined;
}

// The OTHER contract this same component is invoked with: dashboards/chart-loader.ts +
// InsightTile.tsx's InsightChartProps, which every apps/web/src/components/charts/
// <ChartType>Chart.tsx is expected to accept (InsightTile's generic loader calls
// `<ChartComponent insight={...} total={...} buckets={...} aggregations={...} />`
// uniformly for whichever chart type an Insight resolves to). Supporting both here — rather
// than picking one — is what lets this component serve both call sites without either one
// needing to reshape its data to fit the other.
export interface BarChartInsightTileProps {
  insight: Insight;
  total: number;
  buckets: AggregationBucket[];
  aggregations: AggregationResult[];
}

export type BarChartProps = BarChartOwnProps | BarChartInsightTileProps;

function isInsightTileProps(props: BarChartProps): props is BarChartInsightTileProps {
  return 'aggregations' in props;
}

export default function BarChart(props: BarChartProps) {
  if (isInsightTileProps(props)) {
    const adapted = adaptAggregationsToSeries(props.aggregations);
    return <BarChartCore categories={adapted.categories} series={adapted.series} values={adapted.values} />;
  }
  return <BarChartCore {...props} />;
}

interface HoverState {
  x: number;
  y: number;
  category: string;
  series: ChartSeriesMeta;
  value: number;
  color: string;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

// Rounded on the data-end only (right), square at the baseline (left) — per the dataviz
// skill's mark spec ("4px rounded data-end, square at the baseline"). A plain <rect rx>
// would round all four corners, misrepresenting the baseline as an "end" too.
function horizontalBarPath(x: number, y: number, width: number, height: number, radius: number): string {
  if (width <= 0) return '';
  const r = Math.max(0, Math.min(radius, width, height / 2));
  if (r <= 0.01) {
    return `M${x},${y} h${width} v${height} h${-width} Z`;
  }
  const straightWidth = Math.max(0, width - r);
  const straightHeight = Math.max(0, height - 2 * r);
  return [
    `M${x},${y}`,
    `h${straightWidth}`,
    `a${r},${r} 0 0 1 ${r},${r}`,
    `v${straightHeight}`,
    `a${r},${r} 0 0 1 ${-r},${r}`,
    `h${-straightWidth}`,
    'Z',
  ].join(' ');
}

function truncateLabel(label: string, maxChars: number): string {
  return label.length > maxChars ? `${label.slice(0, Math.max(0, maxChars - 1))}…` : label;
}

// Horizontal grouped bars — categories run down the y-axis (free-text taxonomy values don't
// fit as rotated x-axis ticks), one baseline-anchored bar per series within each category
// group. A single series takes one hue throughout (categorical slot 1, no legend — the
// chart's title already names the one thing plotted); 2+ series each take their own fixed
// categorical slot and a legend appears. Built as one real <svg> (labels, gridlines, bars,
// value labels) rather than CSS-width divs, so mark geometry (the rounded data-end, the 2px
// gap, the >=8px-equivalent bar thickness) is exact.
function BarChartCore({ categories, series, values, valueFormatter }: BarChartOwnProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const format = valueFormatter ?? formatCompactNumber;

  const barThickness = series.length <= 1 ? 16 : 12;
  const groupHeight = series.length * barThickness + Math.max(0, series.length - 1) * BAR_GAP;
  const rowHeight = groupHeight + GROUP_GAP;
  const totalHeight = TOP_PADDING + categories.length * rowHeight;

  const maxValue = useMemo(() => {
    let max = 0;
    for (const row of values) {
      for (const cell of row) {
        if (cell > max) max = cell;
      }
    }
    return niceMax(max);
  }, [values]);

  if (categories.length === 0 || series.length === 0) {
    return <EmptyState icon={BarChart3} title="No data" description="Nothing matched this insight's query yet." />;
  }

  function xForValue(value: number): number {
    return maxValue > 0 ? (value / maxValue) * PLOT_WIDTH : 0;
  }

  const gridLines = [0, 0.5, 1].map((fraction) => ({
    x: PLOT_LEFT + fraction * PLOT_WIDTH,
    value: Math.round(maxValue * fraction),
  }));

  const showValueLabels = categories.length * series.length <= MAX_LABELED_MARKS;
  const labelMaxChars = Math.floor(LABEL_WIDTH / 6.2); // ~6px average glyph width at 11px

  function handleBarMove(
    event: MouseEvent<SVGPathElement> | FocusEvent<SVGPathElement>,
    category: string,
    seriesMeta: ChartSeriesMeta,
    value: number,
    color: string,
  ) {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const markRect = event.currentTarget.getBoundingClientRect();
    setHover({
      x: markRect.right - containerRect.left,
      y: markRect.top - containerRect.top + markRect.height / 2,
      category,
      series: seriesMeta,
      value,
      color,
    });
  }

  const chart = (
    <div ref={containerRef} className="relative">
      <div className="rounded-md p-3" style={{ backgroundColor: 'var(--chart-surface)' }}>
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${totalHeight}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height: totalHeight }}
          role="img"
          aria-label="Bar chart"
        >
          {gridLines.map((line) => (
            <g key={line.x}>
              <line
                x1={line.x}
                x2={line.x}
                y1={TOP_PADDING}
                y2={totalHeight}
                stroke="var(--chart-gridline)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text x={line.x} y={TOP_PADDING - 6} textAnchor="middle" fontSize={9} fill="var(--chart-ink-muted)">
                {formatCompactNumber(line.value)}
              </text>
            </g>
          ))}
          <line
            x1={PLOT_LEFT}
            x2={PLOT_LEFT}
            y1={TOP_PADDING}
            y2={totalHeight}
            stroke="var(--chart-baseline)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />

          {categories.map((category, categoryIndex) => {
            const groupTop = TOP_PADDING + categoryIndex * rowHeight + GROUP_GAP / 2;
            const groupCenter = groupTop + groupHeight / 2;
            return (
              <g key={category}>
                <text x={2} y={groupCenter} dominantBaseline="middle" fontSize={11} fill="var(--chart-ink-primary)">
                  {truncateLabel(category, labelMaxChars)}
                  <title>{category}</title>
                </text>
                {series.map((seriesMeta, seriesIndex) => {
                  const value = valueAt(values, seriesIndex, categoryIndex);
                  const barY = groupTop + seriesIndex * (barThickness + BAR_GAP);
                  const barWidth = value > 0 ? Math.max(xForValue(value), 2) : 0;
                  const color = series.length === 1 ? categoricalColor(0) : categoricalColor(seriesIndex);
                  return (
                    <path
                      key={seriesMeta.key}
                      d={horizontalBarPath(PLOT_LEFT, barY, barWidth, barThickness, BAR_RADIUS)}
                      fill={color}
                      opacity={hover && hover.series.key !== seriesMeta.key ? 0.85 : 1}
                      onMouseMove={(event) => handleBarMove(event, category, seriesMeta, value, color)}
                      onFocus={(event) => handleBarMove(event, category, seriesMeta, value, color)}
                      onMouseLeave={() => setHover(null)}
                      onBlur={() => setHover(null)}
                      tabIndex={0}
                      style={{ cursor: 'pointer' }}
                    />
                  );
                })}
                {showValueLabels
                  ? series.map((seriesMeta, seriesIndex) => {
                      const value = valueAt(values, seriesIndex, categoryIndex);
                      const barY = groupTop + seriesIndex * (barThickness + BAR_GAP);
                      const barWidth = xForValue(value);
                      return (
                        <text
                          key={`${seriesMeta.key}-label`}
                          x={PLOT_LEFT + barWidth + 6}
                          y={barY + barThickness / 2}
                          dominantBaseline="middle"
                          fontSize={10}
                          fontWeight={600}
                          fill="var(--chart-ink-secondary)"
                        >
                          {format(value)}
                        </text>
                      );
                    })
                  : null}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend — present whenever >=2 series, rect swatches (bars are an "area" mark per
          the skill's legend convention). Omitted for exactly 1 series: one color, and the
          chart's own title/label already says what it is. */}
      {series.length >= 2 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {series.map((seriesMeta, index) => (
            <li key={seriesMeta.key} className="flex items-center gap-1.5 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: categoricalColor(index) }}
                aria-hidden="true"
              />
              <span className="text-muted-foreground">{seriesMeta.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {hover ? (
        <ChartTooltip
          x={hover.x}
          y={hover.y}
          value={format(hover.value)}
          label={series.length >= 2 ? `${hover.category} · ${hover.series.label}` : hover.category}
          swatchColor={hover.color}
        />
      ) : null}
    </div>
  );

  const table = (
    <ChartDataTable categoryHeader="Category" categories={categories} series={series} values={values} formatValue={format} />
  );

  return <ChartViewToggle ariaLabel="Bar chart" chart={chart} table={table} />;
}
