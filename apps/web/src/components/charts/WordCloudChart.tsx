import { useMemo, useRef, useState, type MouseEvent } from 'react';
import { Cloud } from 'lucide-react';

import type { AggregationBucket } from '@content-insights/shared';

import { formatCompactNumber } from '../../lib/format';
import EmptyState from '../EmptyState';
import ChartDataTable from './ChartDataTable';
import ChartViewToggle from './ChartViewToggle';
import { categoricalColor, MAX_CATEGORICAL_SERIES } from './chart-types';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 340;
const MIN_FONT = 12;
const MAX_FONT = 44;
const WORD_PADDING = 3;
// A rough, font-metrics-free glyph-width estimate for a sans-serif face — deliberately
// generous (real average is closer to ~0.52) so the collision test over-, not under-,
// estimates a word's box: an overlap-free layout matters more here than tight packing.
const CHAR_WIDTH_FACTOR = 0.62;
const LINE_HEIGHT_FACTOR = 1.2;
const ANGLE_STEP = 0.5;
const RADIUS_STEP = 3;
const MAX_SPIRAL_STEPS = 2000;
// Visually placing every one of up to WORD_CLOUD_MAX_WORDS (300) words would produce
// mostly-illegible micro-text regardless of packing quality — real word clouds top out
// well before that. The table view (below) is the complete, ungated list; this is only
// the visual cap.
const CLOUD_RENDER_LIMIT = 120;

interface PlacedWord {
  key: string;
  count: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  color: string;
}

interface HoverState {
  key: string;
  x: number;
  y: number;
}

interface WordCloudChartProps {
  // The word-frequency bucket set — for a wordCloud-type Insight, GET /api/insights/:id/data
  // returns exactly one aggregation named 'words' (see insight.routes.ts), so callers pass
  // `aggregations[0]?.buckets`. Optional/defaulted defensively: InsightTile.tsx's generic
  // chart-loader contract (dashboards/chart-loader.ts's InsightChartProps) already resolves
  // that for every chart type as `buckets`, but a caller on a different path forgetting it
  // should degrade to the empty state below, never throw.
  buckets?: AggregationBucket[] | undefined;
}

// Archimedean-spiral placement: words are placed largest-first, starting at the center
// and walking outward along a spiral until a spot is found whose padded bounding box
// doesn't intersect any word already placed. This is the same idea d3-cloud/Wordle use,
// simplified to a rectangle test (no per-glyph pixel mask) — per the brief, that's an
// acceptable trade as long as it genuinely avoids overlap rather than faking it.
function layoutWordCloud(sorted: AggregationBucket[], width: number, height: number): PlacedWord[] {
  if (sorted.length === 0) return [];
  const maxCount = sorted[0]!.count;
  const minCount = sorted[sorted.length - 1]!.count;
  const tierSize = Math.max(1, Math.ceil(sorted.length / MAX_CATEGORICAL_SERIES));
  const maxRadius = Math.hypot(width, height);
  const centerX = width / 2;
  const centerY = height / 2;

  const placed: PlacedWord[] = [];

  sorted.forEach((bucket, index) => {
    const t = maxCount === minCount ? 0.5 : Math.sqrt((bucket.count - minCount) / (maxCount - minCount));
    let fontSize = MIN_FONT + t * (MAX_FONT - MIN_FONT);
    let w = bucket.key.length * fontSize * CHAR_WIDTH_FACTOR + WORD_PADDING * 2;
    // A single very long word (or a very short viewBox) could otherwise never find an
    // in-bounds spot — clamp its box to fit rather than spiral forever.
    const maxWidth = width * 0.94;
    if (w > maxWidth) {
      fontSize *= maxWidth / w;
      w = maxWidth;
    }
    const h = fontSize * LINE_HEIGHT_FACTOR + WORD_PADDING * 2;
    const colorIndex = Math.min(MAX_CATEGORICAL_SERIES - 1, Math.floor(index / tierSize));

    // Falls back to the last in-bounds candidate if the step budget is exhausted before
    // finding a clean spot (only realistic once the render limit packs in near-solid) —
    // a rare, slight overlap beats silently dropping the word off the visual.
    let bestX = centerX;
    let bestY = centerY;
    for (let step = 0; step < MAX_SPIRAL_STEPS; step++) {
      const angle = step * ANGLE_STEP;
      const radius = RADIUS_STEP * step;
      if (radius > maxRadius) break;
      const cx = centerX + radius * Math.cos(angle);
      const cy = centerY + radius * Math.sin(angle);
      const inBounds = cx - w / 2 >= 0 && cx + w / 2 <= width && cy - h / 2 >= 0 && cy + h / 2 <= height;
      if (!inBounds) continue;
      bestX = cx;
      bestY = cy;
      const collides = placed.some(
        (p) => !(cx + w / 2 < p.x - p.w / 2 || cx - w / 2 > p.x + p.w / 2 || cy + h / 2 < p.y - p.h / 2 || cy - h / 2 > p.y + p.h / 2),
      );
      if (!collides) break;
    }
    placed.push({ key: bucket.key, count: bucket.count, x: bestX, y: bestY, w, h, fontSize, color: categoricalColor(colorIndex) });
  });

  return placed;
}

// Term-frequency word cloud — the one chart type where the mark genuinely *is* colored
// text (there's no separate bar/area/dot to carry the hue), so this intentionally departs
// from the "text never wears the data color" chrome rule, which governs axis/legend/
// tooltip labels, not a chart whose data marks are typographic by definition. Color is
// assigned by frequency-rank TIER (up to 8 contiguous rank buckets, fixed slot order via
// chart-types' categoricalColor), never per-word/random, and every word's exact count
// stays reachable without relying on hue — via hover tooltip, the tier legend's printed
// ranges, and the full table view. Canvas chrome (gridline-less here, but tooltip/legend
// ink) uses the dedicated --chart-* token set, same as Bar/Radar/HeatMap, not the app's
// ambient --text-*/--bg-card tokens — see index.css's comment on --chart-surface.
export default function WordCloudChart({ buckets = [] }: WordCloudChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const sorted = useMemo(() => [...buckets].sort((a, b) => b.count - a.count), [buckets]);
  const visible = useMemo(() => sorted.slice(0, CLOUD_RENDER_LIMIT), [sorted]);
  const placed = useMemo(() => layoutWordCloud(visible, VIEW_WIDTH, VIEW_HEIGHT), [visible]);

  const tiers = useMemo(() => {
    const tierSize = Math.max(1, Math.ceil(visible.length / MAX_CATEGORICAL_SERIES));
    const rows: { color: string; min: number; max: number }[] = [];
    for (let i = 0; i < visible.length; i += tierSize) {
      const slice = visible.slice(i, i + tierSize);
      const counts = slice.map((b) => b.count);
      rows.push({ color: categoricalColor(rows.length), min: Math.min(...counts), max: Math.max(...counts) });
    }
    return rows;
  }, [visible]);

  if (buckets.length === 0) {
    return <EmptyState icon={Cloud} title="No data" description="No words matched this widget's query yet." />;
  }

  function handleMove(event: MouseEvent<SVGRectElement>, key: string) {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const wordRect = event.currentTarget.getBoundingClientRect();
    setHover({ key, x: wordRect.left - containerRect.left + wordRect.width / 2, y: wordRect.top - containerRect.top });
  }

  const hoveredWord = hover ? (placed.find((p) => p.key === hover.key) ?? null) : null;

  const chart = (
    <div ref={containerRef} className="relative">
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="h-auto w-full" role="img" aria-label="Word frequency cloud">
        {placed.map((word) => (
          <g key={word.key}>
            <text
              x={word.x}
              y={word.y}
              fontSize={word.fontSize}
              fill={word.color}
              textAnchor="middle"
              dominantBaseline="central"
              fontWeight={600}
              pointerEvents="none"
            >
              {word.key}
            </text>
            {/* Padded, invisible hit target — bigger than the glyph outlines themselves,
                per the skill's "hit target bigger than the mark" rule. */}
            <rect
              x={word.x - word.w / 2}
              y={word.y - word.h / 2}
              width={word.w}
              height={word.h}
              fill="transparent"
              onMouseMove={(event) => handleMove(event, word.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={(event) => handleMove(event as unknown as MouseEvent<SVGRectElement>, word.key)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              role="button"
              aria-label={`${word.key}: ${formatCompactNumber(word.count)}`}
              style={{ cursor: 'pointer' }}
            />
          </g>
        ))}
      </svg>

      {hover && hoveredWord ? (
        <div
          className="pointer-events-none absolute z-10 flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-button)] border border-[var(--chart-gridline)] px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: hover.x, top: hover.y, transform: 'translate(-50%, calc(-100% - 10px))', backgroundColor: 'var(--chart-surface)' }}
          role="tooltip"
        >
          <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: hoveredWord.color }} aria-hidden="true" />
          <span className="font-semibold text-[var(--chart-ink-primary)]">{formatCompactNumber(hoveredWord.count)}</span>
          <span className="text-[var(--chart-ink-secondary)]">{hoveredWord.key}</span>
        </div>
      ) : null}

      {sorted.length > visible.length ? (
        <p className="mt-2 text-center text-[10px] text-[var(--chart-ink-muted)]">
          Showing the top {visible.length} of {sorted.length} words by frequency — see the table view for the full list.
        </p>
      ) : null}

      {/* Frequency-tier legend — the non-color channel that keeps hue from being the only
          way to read relative frequency (exact counts also live in the tooltip and the
          table view). */}
      {tiers.length > 1 ? (
        <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[10px] text-[var(--chart-ink-secondary)]">
          {tiers.map((tier, index) => (
            <li key={index} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: tier.color }} aria-hidden="true" />
              <span>{tier.min === tier.max ? formatCompactNumber(tier.min) : `${formatCompactNumber(tier.max)}–${formatCompactNumber(tier.min)}`}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  const table = (
    <ChartDataTable categoryHeader="Word" categories={sorted.map((b) => b.key)} series={[{ key: 'count', label: 'Count' }]} values={[sorted.map((b) => b.count)]} />
  );

  return <ChartViewToggle ariaLabel="Word cloud" chart={chart} table={table} />;
}
