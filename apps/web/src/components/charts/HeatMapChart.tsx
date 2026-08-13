import { useMemo, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { Grid3x3 } from 'lucide-react';

import type { AggregationBucket, AggregationResult, Insight } from '@content-insights/shared';

import { formatCompactNumber } from '../../lib/format';
import EmptyState from '../EmptyState';
import ChartDataTable from './ChartDataTable';
import ChartTooltip from './ChartTooltip';
import ChartViewToggle from './ChartViewToggle';
import { sequentialStep, valueAt, SEQUENTIAL_CHART_STEPS, type ChartSeriesMeta, type ChartValueMatrix } from './chart-types';

const CELL_SIZE = 30;
const CELL_GAP = 2; // the mark spec's 2px surface gap between touching marks
const ROW_LABEL_WIDTH = 130;
const TOP_LABEL_HEIGHT = 80; // room for the rotated column labels
const ROW_LABEL_MAX_CHARS = 20;
const COLUMN_LABEL_MAX_CHARS = 22;

// HeatMapChart's two axes are both categorical (row identity x column identity); magnitude
// — the actual cell value — is what needs an encoding, and per the dataviz skill that's a
// SEQUENTIAL ramp (one hue, light -> dark), never the categorical 8-hue set: color here
// means "how much", not "which entity". `categories` are the columns (x), `series` are the
// rows (y) — kept as the same (categories, series, values) shape as Bar/RadarChart for a
// consistent contract, even though the semantic role of each axis differs here. This is
// this repo's own low-level contract, used directly by InsightBuilderModal's illustrative
// preview — see HeatMapChartInsightTileProps below for the other contract this same
// component accepts.
export interface HeatMapChartOwnProps {
  categories: string[]; // columns (x)
  series: ChartSeriesMeta[]; // rows (y)
  values: ChartValueMatrix; // values[rowIndex][columnIndex]
  valueFormatter?: ((value: number) => string) | undefined;
}

// dashboards/chart-loader.ts + InsightTile.tsx's InsightChartProps — see BarChart.tsx's
// identical comment for why this component accepts both shapes.
export interface HeatMapChartInsightTileProps {
  insight: Insight;
  total: number;
  buckets: AggregationBucket[];
  aggregations: AggregationResult[];
}

export type HeatMapChartProps = HeatMapChartOwnProps | HeatMapChartInsightTileProps;

function isInsightTileProps(props: HeatMapChartProps): props is HeatMapChartInsightTileProps {
  return 'aggregations' in props;
}

interface HoverState {
  x: number;
  y: number;
  row: string;
  column: string;
  value: number;
}

function truncateLabel(label: string, maxChars: number): string {
  return label.length > maxChars ? `${label.slice(0, Math.max(0, maxChars - 1))}…` : label;
}

// A real heat map needs a JOINT count per (row, column) cell. GET /api/insights/:id/data
// returns two INDEPENDENT terms aggregations for heatMap's 'x'/'y' roles (see
// insight.routes.ts) — never a cross-tabulation — so there's no honest cell value to draw
// when both are present. Rather than fabricate one (see aggregation-adapter.ts's and
// RelationshipChart.tsx's identical stance on this same backend gap), a single real
// dimension renders as a one-row heat strip, and two independent dimensions render as a
// named "not available yet" note instead of an invented grid.
function HeatMapFromAggregations({ aggregations }: { aggregations: AggregationResult[] }) {
  const [first, second] = aggregations;
  if (!first) {
    return <EmptyState icon={Grid3x3} title="No data" description="Nothing matched this insight's query yet." />;
  }
  if (!second) {
    return (
      <HeatMapChartCore
        categories={first.buckets.map((bucket) => bucket.key)}
        series={[{ key: first.name, label: first.name }]}
        values={[first.buckets.map((bucket) => bucket.count)]}
      />
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border py-10 text-center">
      <p className="text-sm font-medium text-foreground">Cross-tab not available yet</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        &quot;{first.name}&quot; ({first.buckets.length} values) and &quot;{second.name}&quot; (
        {second.buckets.length} values) are each known independently, but their joint counts aren&apos;t computed by
        the API yet.
      </p>
    </div>
  );
}

export default function HeatMapChart(props: HeatMapChartProps) {
  if (isInsightTileProps(props)) {
    return <HeatMapFromAggregations aggregations={props.aggregations} />;
  }
  return <HeatMapChartCore {...props} />;
}

function HeatMapChartCore({ categories, series, values, valueFormatter }: HeatMapChartOwnProps) {
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
    return max;
  }, [values]);

  if (categories.length === 0 || series.length === 0) {
    return <EmptyState icon={Grid3x3} title="No data" description="Nothing matched this insight's query yet." />;
  }

  const gridWidth = categories.length * CELL_SIZE;
  const gridHeight = series.length * CELL_SIZE;
  const totalWidth = ROW_LABEL_WIDTH + gridWidth;
  const totalHeight = TOP_LABEL_HEIGHT + gridHeight;

  function handleCellMove(
    event: MouseEvent<SVGRectElement> | FocusEvent<SVGRectElement>,
    row: string,
    column: string,
    value: number,
  ) {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const cellRect = event.currentTarget.getBoundingClientRect();
    setHover({
      x: cellRect.left - containerRect.left + cellRect.width / 2,
      y: cellRect.top - containerRect.top,
      row,
      column,
      value,
    });
  }

  const chart = (
    <div ref={containerRef} className="relative">
      <div className="overflow-x-auto rounded-md p-3" style={{ backgroundColor: 'var(--chart-surface)' }}>
        <svg
          width={totalWidth}
          height={totalHeight}
          viewBox={`0 0 ${totalWidth} ${totalHeight}`}
          role="img"
          aria-label="Heat map"
        >
          {/* Column headers — rotated so 20+ taxonomy-value labels stay legible */}
          {categories.map((column, columnIndex) => {
            const x = ROW_LABEL_WIDTH + columnIndex * CELL_SIZE + CELL_SIZE / 2;
            return (
              <text
                key={column}
                x={0}
                y={0}
                transform={`translate(${x}, ${TOP_LABEL_HEIGHT - 6}) rotate(-40)`}
                textAnchor="end"
                fontSize={10}
                fill="var(--chart-ink-primary)"
              >
                {truncateLabel(column, COLUMN_LABEL_MAX_CHARS)}
                <title>{column}</title>
              </text>
            );
          })}

          {/* Row headers */}
          {series.map((seriesMeta, rowIndex) => (
            <text
              key={seriesMeta.key}
              x={ROW_LABEL_WIDTH - 8}
              y={TOP_LABEL_HEIGHT + rowIndex * CELL_SIZE + CELL_SIZE / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill="var(--chart-ink-primary)"
            >
              {truncateLabel(seriesMeta.label, ROW_LABEL_MAX_CHARS)}
              <title>{seriesMeta.label}</title>
            </text>
          ))}

          {/* Cells — sequential fill (magnitude), never the categorical ramp. Zero/no-data
              cells render as the bare chart surface with a hairline outline, distinct from
              the ramp's own lightest ("near-zero but present") step. */}
          {series.map((seriesMeta, rowIndex) =>
            categories.map((column, columnIndex) => {
              const value = valueAt(values, rowIndex, columnIndex);
              const x = ROW_LABEL_WIDTH + columnIndex * CELL_SIZE + CELL_GAP / 2;
              const y = TOP_LABEL_HEIGHT + rowIndex * CELL_SIZE + CELL_GAP / 2;
              const size = CELL_SIZE - CELL_GAP;
              const isEmpty = value <= 0;
              const fill = isEmpty ? 'var(--chart-surface)' : sequentialStep(maxValue > 0 ? value / maxValue : 0);
              return (
                <rect
                  key={`${seriesMeta.key}-${column}`}
                  x={x}
                  y={y}
                  width={size}
                  height={size}
                  rx={2}
                  fill={fill}
                  stroke={isEmpty ? 'var(--chart-gridline)' : 'none'}
                  strokeWidth={isEmpty ? 1 : 0}
                  onMouseMove={(event) => handleCellMove(event, seriesMeta.label, column, value)}
                  onFocus={(event) => handleCellMove(event, seriesMeta.label, column, value)}
                  onMouseLeave={() => setHover(null)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                />
              );
            }),
          )}
        </svg>
      </div>

      {/* Scale legend — magnitude is sequential, not categorical identity, so this is a
          min/max gradient key rather than a per-series swatch legend (dataviz skill:
          sequential ramps always ship with a scale legend, never a rainbow / bare color). */}
      <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>0</span>
        <div className="flex h-2.5 overflow-hidden rounded-[2px]">
          {SEQUENTIAL_CHART_STEPS.map((step) => (
            <span key={step} className="w-4" style={{ backgroundColor: step }} aria-hidden="true" />
          ))}
        </div>
        <span>{format(maxValue)}</span>
      </div>

      {hover ? (
        <ChartTooltip x={hover.x} y={hover.y} value={format(hover.value)} label={`${hover.row} · ${hover.column}`} />
      ) : null}
    </div>
  );

  // Mirrors the same (categories, series, values) data the grid renders — rows and columns
  // land transposed relative to the visual grid (ChartDataTable's fixed convention puts
  // `categories` down the rows and `series` across the columns), but every value shown is
  // identical, which is what the accessibility pass actually requires.
  const table = (
    <ChartDataTable categoryHeader="Column" categories={categories} series={series} values={values} formatValue={format} />
  );

  return <ChartViewToggle ariaLabel="Heat map" chart={chart} table={table} />;
}
