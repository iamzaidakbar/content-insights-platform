import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { LayoutGrid } from 'lucide-react';

import type { AggregationBucket } from '@content-insights/shared';

import { formatCompactNumber } from '../../lib/format';
import EmptyState from '../EmptyState';
import ChartDataTable from './ChartDataTable';
import ChartViewToggle from './ChartViewToggle';
import { categoricalColor, MAX_CATEGORICAL_SERIES } from './chart-types';

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 340;
const CELL_GAP_STROKE = 2;
const CELL_PADDING = 4;
const NAME_FONT = 12;
const VALUE_FONT = 10.5;

// [light, dark] hex mirroring index.css's --chart-1..8 / --chart-other — duplicated here
// ONLY so this component can compute per-tile label ink (white vs near-black) from the
// tile's ACTUAL resolved fill color. The fill itself is always painted via the CSS var
// (categoricalColor()/OTHER_COLOR below); this table never drives paint, only the
// black-vs-white label decision the skill calls out as the one place a colored fill's
// label is allowed to sit directly on top of it.
const CATEGORICAL_HEX: readonly [string, string][] = [
  ['#2a78d6', '#3987e5'],
  ['#eb6834', '#d95926'],
  ['#1baf7a', '#199e70'],
  ['#eda100', '#c98500'],
  ['#e87ba4', '#d55181'],
  ['#008300', '#008300'],
  ['#4a3aa7', '#9085e9'],
  ['#e34948', '#e66767'],
];
const OTHER_HEX: [string, string] = ['#9295a0', '#4b5566'];
const OTHER_COLOR = 'var(--chart-other)';

function resolveIsDark(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(resolveIsDark);
  useEffect(() => {
    const update = () => setIsDark(resolveIsDark());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16) / 255;
  const g = Number.parseInt(clean.slice(2, 4), 16) / 255;
  const b = Number.parseInt(clean.slice(4, 6), 16) / 255;
  const linear = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

// Picks whichever of white/near-black ink has the higher WCAG contrast ratio against the
// tile's actual fill — not a fixed 50% luminance guess. This matters concretely for slot 7
// (violet): its light-theme fill (#4a3aa7) needs white text, but its dark-theme fill
// (#9085e9, a pale lavender) needs dark text — the two variants cross the threshold.
function inkForFill(hex: string): string {
  const l = relativeLuminance(hex);
  const contrastWithWhite = 1.05 / (l + 0.05);
  const contrastWithBlack = (l + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? '#ffffff' : '#0b0b0b';
}

interface TreeItem {
  key: string;
  count: number;
  color: string;
  ink: string;
}

interface TreeRect extends TreeItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface AreaItem {
  index: number;
  value: number;
}

function worstRatio(row: AreaItem[], sum: number, side: number): number {
  if (sum <= 0 || side <= 0) return Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (const item of row) {
    if (item.value > max) max = item.value;
    if (item.value < min) min = item.value;
  }
  const term1 = (side * side * max) / (sum * sum);
  const term2 = (sum * sum) / (side * side * min);
  return Math.max(term1, term2);
}

// Squarified treemap (Bruls/Huizing/van Wijk): builds one "row" at a time along the
// container's current shorter side, growing it while doing so keeps improving (not
// worsening) the worst aspect ratio in that row, then lays the row out as a band spanning
// the shorter side and shrinks the remaining rect by the band's thickness. Chosen over
// plain slice-and-dice because it keeps individual cells closer to square, which is what
// makes direct labels fit at all on a wide range of value distributions.
function squarify(items: AreaItem[], x: number, y: number, width: number, height: number, out: Map<number, { x: number; y: number; w: number; h: number }>): void {
  let remaining = items;
  let rx = x;
  let ry = y;
  let rw = width;
  let rh = height;

  while (remaining.length > 0) {
    const side = Math.min(rw, rh);
    const first = remaining[0]!;
    let row: AreaItem[] = [first];
    let sum = first.value;
    let worst = worstRatio(row, sum, side);
    let i = 1;
    while (i < remaining.length) {
      const next = remaining[i]!;
      const candidateRow = [...row, next];
      const candidateSum = sum + next.value;
      const candidateWorst = worstRatio(candidateRow, candidateSum, side);
      if (candidateWorst > worst) break;
      row = candidateRow;
      sum = candidateSum;
      worst = candidateWorst;
      i++;
    }

    remaining = remaining.slice(row.length);

    if (rw >= rh) {
      const bandWidth = rh > 0 ? sum / rh : 0;
      let cy = ry;
      for (const item of row) {
        const itemHeight = sum > 0 ? rh * (item.value / sum) : 0;
        out.set(item.index, { x: rx, y: cy, w: bandWidth, h: itemHeight });
        cy += itemHeight;
      }
      rx += bandWidth;
      rw -= bandWidth;
    } else {
      const bandHeight = rw > 0 ? sum / rw : 0;
      let cx = rx;
      for (const item of row) {
        const itemWidth = sum > 0 ? rw * (item.value / sum) : 0;
        out.set(item.index, { x: cx, y: ry, w: itemWidth, h: bandHeight });
        cx += itemWidth;
      }
      ry += bandHeight;
      rh -= bandHeight;
    }
  }
}

function layoutTreemap(items: TreeItem[], width: number, height: number): TreeRect[] {
  if (items.length === 0) return [];
  const totalValue = items.reduce((sum, item) => sum + item.count, 0);
  if (totalValue <= 0) return [];
  const scale = (width * height) / totalValue;
  const areaItems: AreaItem[] = items.map((item, index) => ({ index, value: item.count * scale }));
  const placements = new Map<number, { x: number; y: number; w: number; h: number }>();
  squarify(areaItems, 0, 0, width, height, placements);
  return items.map((item, index) => ({ ...item, ...(placements.get(index) ?? { x: 0, y: 0, w: 0, h: 0 }) }));
}

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.56;
}

interface HoverState {
  key: string;
  x: number;
  y: number;
}

interface TreeMapChartProps {
  // A single flat terms aggregation (one top-level category per bucket) — this is what
  // GET /api/insights/:id/data actually returns per field mapping today (no nested
  // parent/child bucket shape exists server-side yet). "Hierarchical" per the brief means
  // this renders whatever depth it's given; with today's data that's one level. Matches
  // InsightTile.tsx's generic chart-loader contract (dashboards/chart-loader.ts's
  // InsightChartProps.buckets) — optional/defaulted defensively for any other caller.
  buckets?: AggregationBucket[] | undefined;
}

// Squarified treemap, sized by count, one hue per top-level category in fixed rank order
// (categoricalColor from chart-types.ts — the same 8-slot ramp Bar/Radar/HeatMap use).
// Canvas chrome (cell borders, tooltip, table) uses the dedicated --chart-* token set, not
// the app's ambient --border/--background/--foreground -- see index.css's --chart-surface comment.
export default function TreeMapChart({ buckets = [] }: TreeMapChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const isDark = useIsDarkTheme();

  const positive = useMemo(() => [...buckets].filter((b) => b.count > 0).sort((a, b) => b.count - a.count), [buckets]);

  const folded = useMemo(() => {
    if (positive.length <= MAX_CATEGORICAL_SERIES) return positive;
    const visible = positive.slice(0, MAX_CATEGORICAL_SERIES - 1);
    const rest = positive.slice(MAX_CATEGORICAL_SERIES - 1);
    const otherCount = rest.reduce((sum, b) => sum + b.count, 0);
    return [...visible, { key: 'Other', count: otherCount }];
  }, [positive]);

  const items: TreeItem[] = useMemo(
    () =>
      folded.map((bucket, index) => {
        const isOther = bucket.key === 'Other' && positive.length > MAX_CATEGORICAL_SERIES && index === folded.length - 1;
        const hexPair = isOther ? OTHER_HEX : (CATEGORICAL_HEX[index] ?? CATEGORICAL_HEX[0]!);
        const fillHex = isDark ? hexPair[1] : hexPair[0];
        return {
          key: bucket.key,
          count: bucket.count,
          color: isOther ? OTHER_COLOR : categoricalColor(index),
          ink: inkForFill(fillHex),
        };
      }),
    [folded, positive.length, isDark],
  );

  const rects = useMemo(() => layoutTreemap(items, VIEW_WIDTH, VIEW_HEIGHT), [items]);
  const total = items.reduce((sum, item) => sum + item.count, 0);

  if (rects.length === 0) {
    return <EmptyState icon={LayoutGrid} title="No data" description="Nothing matched this widget's query yet." />;
  }

  function handleMove(event: MouseEvent<SVGRectElement>, key: string) {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const cellRect = event.currentTarget.getBoundingClientRect();
    setHover({ key, x: cellRect.left - containerRect.left + cellRect.width / 2, y: cellRect.top - containerRect.top + cellRect.height / 2 });
  }

  const hoveredRect = hover ? (rects.find((r) => r.key === hover.key) ?? null) : null;

  const chart = (
    <div ref={containerRef} className="relative">
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="h-auto w-full" role="img" aria-label="Category breakdown treemap">
        {rects.map((rect) => {
          const valueText = formatCompactNumber(rect.count);
          const innerW = rect.w - CELL_PADDING * 2;
          const innerH = rect.h - CELL_PADDING * 2;
          const nameWidth = estimateTextWidth(rect.key, NAME_FONT);
          const valueWidth = estimateTextWidth(valueText, VALUE_FONT);
          const showTwoLines = innerH >= (NAME_FONT + VALUE_FONT) * 1.35 && innerW >= Math.max(nameWidth, valueWidth);
          const showOneLine = !showTwoLines && innerH >= NAME_FONT * 1.3 && innerW >= nameWidth;
          const centerX = rect.x + rect.w / 2;
          const centerY = rect.y + rect.h / 2;
          return (
            <g key={rect.key}>
              <rect
                x={rect.x}
                y={rect.y}
                width={Math.max(rect.w, 0)}
                height={Math.max(rect.h, 0)}
                fill={rect.color}
                stroke="var(--chart-surface)"
                strokeWidth={CELL_GAP_STROKE}
                onMouseMove={(event) => handleMove(event, rect.key)}
                onMouseLeave={() => setHover(null)}
                onFocus={(event) => handleMove(event as unknown as MouseEvent<SVGRectElement>, rect.key)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                role="button"
                aria-label={`${rect.key}: ${valueText}`}
                style={{ cursor: 'pointer', transition: 'opacity 150ms' }}
                opacity={hover && hover.key !== rect.key ? 0.75 : 1}
              />
              {showTwoLines ? (
                <>
                  <text x={centerX} y={centerY - VALUE_FONT * 0.6} textAnchor="middle" dominantBaseline="central" fontSize={NAME_FONT} fontWeight={600} fill={rect.ink} pointerEvents="none">
                    {rect.key}
                  </text>
                  <text x={centerX} y={centerY + NAME_FONT * 0.65} textAnchor="middle" dominantBaseline="central" fontSize={VALUE_FONT} fill={rect.ink} opacity={0.85} pointerEvents="none">
                    {valueText}
                  </text>
                </>
              ) : showOneLine ? (
                <text x={centerX} y={centerY} textAnchor="middle" dominantBaseline="central" fontSize={NAME_FONT} fontWeight={600} fill={rect.ink} pointerEvents="none">
                  {rect.key}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {hover && hoveredRect ? (
        <div
          className="pointer-events-none absolute z-10 flex items-center gap-2 whitespace-nowrap rounded-md border border-border px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: hover.x, top: hover.y, transform: 'translate(-50%, calc(-100% - 10px))', backgroundColor: 'var(--chart-surface)' }}
          role="tooltip"
        >
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: hoveredRect.color }} aria-hidden="true" />
          <span className="font-semibold text-foreground">{formatCompactNumber(hoveredRect.count)}</span>
          <span className="text-muted-foreground">
            {hoveredRect.key}
            {total > 0 ? ` (${((hoveredRect.count / total) * 100).toFixed(0)}%)` : ''}
          </span>
        </div>
      ) : null}
    </div>
  );

  const table = <ChartDataTable categoryHeader="Category" categories={items.map((i) => i.key)} series={[{ key: 'count', label: 'Count' }]} values={[items.map((i) => i.count)]} />;

  return <ChartViewToggle ariaLabel="Treemap" chart={chart} table={table} />;
}
