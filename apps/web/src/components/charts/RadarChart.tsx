import { useMemo, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { Radar as RadarIcon } from 'lucide-react';

import type { AggregationBucket, AggregationResult, Insight } from '@content-insights/shared';

import { formatCompactNumber } from '../../lib/format';
import EmptyState from '../EmptyState';
import { adaptAggregationsToSeries } from './aggregation-adapter';
import ChartDataTable from './ChartDataTable';
import ChartTooltip from './ChartTooltip';
import ChartViewToggle from './ChartViewToggle';
import { categoricalColor, valueAt, type ChartSeriesMeta, type ChartValueMatrix } from './chart-types';

const SIZE = 360;
const CENTER = SIZE / 2;
const MAX_RADIUS = SIZE / 2 - 56; // leaves room for axis labels outside the outer ring
const RING_FRACTIONS = [1 / 3, 2 / 3, 1];
const MARKER_RADIUS = 4; // >=8px diameter per the mark spec
const MIN_CATEGORIES = 3;

// This repo's own low-level contract — see BarChart.tsx's identical comment for why a chart
// component in this directory needs to accept both this shape and the one below.
export interface RadarChartOwnProps {
  categories: string[]; // one per axis/spoke
  series: ChartSeriesMeta[]; // 1..8 overlaid polygons
  values: ChartValueMatrix;
  valueFormatter?: ((value: number) => string) | undefined;
}

// dashboards/chart-loader.ts + InsightTile.tsx's InsightChartProps — see BarChart.tsx's
// identical comment.
export interface RadarChartInsightTileProps {
  insight: Insight;
  total: number;
  buckets: AggregationBucket[];
  aggregations: AggregationResult[];
}

export type RadarChartProps = RadarChartOwnProps | RadarChartInsightTileProps;

function isInsightTileProps(props: RadarChartProps): props is RadarChartInsightTileProps {
  return 'aggregations' in props;
}

export default function RadarChart(props: RadarChartProps) {
  if (isInsightTileProps(props)) {
    const adapted = adaptAggregationsToSeries(props.aggregations);
    return <RadarChartCore categories={adapted.categories} series={adapted.series} values={adapted.values} />;
  }
  return <RadarChartCore {...props} />;
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

function angleForAxis(index: number, count: number): number {
  return -Math.PI / 2 + (index * (2 * Math.PI)) / count;
}

function pointOnAxis(angle: number, radius: number): { x: number; y: number } {
  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) };
}

function labelAnchorFor(angle: number): 'start' | 'middle' | 'end' {
  const cos = Math.cos(angle);
  if (cos > 0.3) return 'start';
  if (cos < -0.3) return 'end';
  return 'middle';
}

// One shared linear scale across every axis (never a per-axis 0..max normalization) — all
// of an Insight's field mappings are the same measure (article/document counts from a terms
// aggregation), so a single scale is the non-distorting choice; per-axis scaling would let a
// small axis look as "full" as a large one and misstate the comparison.
function RadarChartCore({ categories, series, values, valueFormatter }: RadarChartOwnProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const format = valueFormatter ?? formatCompactNumber;

  const maxValue = useMemo(() => {
    let max = 0;
    for (const row of values) {
      for (const cell of row) {
        if (cell > max) max = cell;
      }
    }
    return niceMax(max);
  }, [values]);

  if (series.length === 0 || categories.length === 0) {
    return <EmptyState icon={RadarIcon} title="No data" description="Nothing matched this insight's query yet." />;
  }
  if (categories.length < MIN_CATEGORIES) {
    return (
      <EmptyState
        icon={RadarIcon}
        title="Not enough axes"
        description={`A radar chart needs at least ${MIN_CATEGORIES} categories to plot — this one has ${categories.length}.`}
      />
    );
  }

  const axisAngles = categories.map((_, index) => angleForAxis(index, categories.length));

  const polygons = series.map((seriesMeta, seriesIndex) => {
    const points = categories.map((category, categoryIndex) => {
      const value = valueAt(values, seriesIndex, categoryIndex);
      const radius = maxValue > 0 ? (value / maxValue) * MAX_RADIUS : 0;
      const angle = axisAngles[categoryIndex] ?? 0;
      return { ...pointOnAxis(angle, radius), category, value };
    });
    return { seriesMeta, color: categoricalColor(seriesIndex), points };
  });

  function handleVertexMove(
    event: MouseEvent<SVGCircleElement> | FocusEvent<SVGCircleElement>,
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
      x: markRect.left - containerRect.left + markRect.width / 2,
      y: markRect.top - containerRect.top,
      category,
      series: seriesMeta,
      value,
      color,
    });
  }

  const chart = (
    <div ref={containerRef} className="relative">
      <div
        className="mx-auto flex justify-center rounded-[var(--radius-input)] p-3"
        style={{ backgroundColor: 'var(--chart-surface)', maxWidth: SIZE + 40 }}
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full" role="img" aria-label="Radar chart">
          {/* Recessive concentric grid + spokes */}
          {RING_FRACTIONS.map((fraction) => (
            <polygon
              key={fraction}
              points={axisAngles.map((angle) => pointOnAxis(angle, MAX_RADIUS * fraction)).map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="var(--chart-gridline)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {axisAngles.map((angle, index) => {
            const outer = pointOnAxis(angle, MAX_RADIUS);
            return (
              <line
                key={categories[index]}
                x1={CENTER}
                y1={CENTER}
                x2={outer.x}
                y2={outer.y}
                stroke="var(--chart-gridline)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {/* Ring value ticks along the top (12 o'clock) spoke */}
          {RING_FRACTIONS.map((fraction) => (
            <text
              key={fraction}
              x={CENTER + 4}
              y={CENTER - MAX_RADIUS * fraction}
              fontSize={9}
              fill="var(--chart-ink-muted)"
            >
              {formatCompactNumber(Math.round(maxValue * fraction))}
            </text>
          ))}

          {/* Axis category labels, anchored by which side of the circle they sit on */}
          {axisAngles.map((angle, index) => {
            const label = categories[index];
            if (label === undefined) return null;
            const labelPoint = pointOnAxis(angle, MAX_RADIUS + 16);
            return (
              <text
                key={label}
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor={labelAnchorFor(angle)}
                dominantBaseline="middle"
                fontSize={11}
                fill="var(--chart-ink-primary)"
              >
                {label}
                <title>{label}</title>
              </text>
            );
          })}

          {/* Series polygons — area fill at ~10% opacity, 2px stroke outline, >=8px markers */}
          {polygons.map(({ seriesMeta, color, points }) => (
            <g key={seriesMeta.key}>
              <polygon
                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={color}
                fillOpacity={0.12}
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {points.map((point) => (
                <g key={point.category}>
                  <circle cx={point.x} cy={point.y} r={MARKER_RADIUS + 1.5} fill="var(--chart-surface)" />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={MARKER_RADIUS}
                    fill={color}
                    onMouseMove={(event) => handleVertexMove(event, point.category, seriesMeta, point.value, color)}
                    onFocus={(event) => handleVertexMove(event, point.category, seriesMeta, point.value, color)}
                    onMouseLeave={() => setHover(null)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                  />
                </g>
              ))}
            </g>
          ))}
        </svg>
      </div>

      {/* Legend — rect swatches (radar's mark is a filled area, per the skill's "rect for
          bars/areas" legend convention), present whenever >=2 series. */}
      {series.length >= 2 ? (
        <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
          {series.map((seriesMeta, index) => (
            <li key={seriesMeta.key} className="flex items-center gap-1.5 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: categoricalColor(index) }}
                aria-hidden="true"
              />
              <span className="text-[var(--text-secondary)]">{seriesMeta.label}</span>
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
    <ChartDataTable categoryHeader="Axis" categories={categories} series={series} values={values} formatValue={format} />
  );

  return <ChartViewToggle ariaLabel="Radar chart" chart={chart} table={table} />;
}
