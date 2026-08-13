import { useCallback, useMemo, useState } from 'react';
import { Cloud, X } from 'lucide-react';
import ReactWordcloud, { type OptionsProp, type Word } from 'react-wordcloud';
import 'tippy.js/dist/tippy.css';

import type { AggregationBucket } from '@content-insights/shared';

import { formatCompactNumber } from '../../lib/format';
import EmptyState from '../EmptyState';
import ChartDataTable from './ChartDataTable';
import ChartViewToggle from './ChartViewToggle';
import { categoricalColor, MAX_CATEGORICAL_SERIES } from './chart-types';

// Visually placing every one of up to WORD_CLOUD_MAX_WORDS (300) words would produce
// mostly-illegible micro-text — the table view is the complete list; this is only the
// visual cap (also matches react-wordcloud's default maxWords).
const CLOUD_RENDER_LIMIT = 120;

const WORDCLOUD_OPTIONS: OptionsProp = {
  colors: [], // unused when getWordColor is set — keep empty so we never fall back to d3's scheme
  deterministic: true,
  enableTooltip: true,
  fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif',
  fontSizes: [14, 48],
  fontWeight: '600',
  padding: 2,
  rotations: 2,
  rotationAngles: [-90, 0],
  scale: 'sqrt',
  spiral: 'archimedean',
  transitionDuration: 400,
  tooltipOptions: {
    theme: 'cip-chart',
    allowHTML: false,
  },
};

interface WordCloudChartProps {
  // The word-frequency bucket set — for a wordCloud-type Insight, GET /api/insights/:id/data
  // returns exactly one aggregation named 'words' (see insight.routes.ts), so callers pass
  // `aggregations[0]?.buckets`. Optional/defaulted defensively: InsightTile's generic
  // chart-loader contract already resolves that for every chart type as `buckets`.
  buckets?: AggregationBucket[] | undefined;
}

// Term-frequency word cloud via react-wordcloud (d3-cloud). Hover uses Tippy tooltips;
// click excludes a word for this session only (undo via chips) — not persisted to the
// insight's temporaryExclusions. Color is assigned by frequency-rank tier via
// chart-types' categoricalColor, same as the previous hand-rolled SVG cloud.
export default function WordCloudChart({ buckets = [] }: WordCloudChartProps) {
  const [excluded, setExcluded] = useState<string[]>([]);

  const sorted = useMemo(() => [...buckets].sort((a, b) => b.count - a.count), [buckets]);
  const excludedSet = useMemo(() => new Set(excluded.map((word) => word.toLowerCase())), [excluded]);

  const visibleBuckets = useMemo(
    () => sorted.filter((bucket) => !excludedSet.has(bucket.key.toLowerCase())).slice(0, CLOUD_RENDER_LIMIT),
    [sorted, excludedSet],
  );

  const colorByText = useMemo(() => {
    const map = new Map<string, string>();
    const tierSize = Math.max(1, Math.ceil(visibleBuckets.length / MAX_CATEGORICAL_SERIES));
    visibleBuckets.forEach((bucket, index) => {
      const colorIndex = Math.min(MAX_CATEGORICAL_SERIES - 1, Math.floor(index / tierSize));
      map.set(bucket.key, categoricalColor(colorIndex));
    });
    return map;
  }, [visibleBuckets]);

  const words = useMemo<Word[]>(
    () => visibleBuckets.map((bucket) => ({ text: bucket.key, value: bucket.count })),
    [visibleBuckets],
  );

  const tiers = useMemo(() => {
    const tierSize = Math.max(1, Math.ceil(visibleBuckets.length / MAX_CATEGORICAL_SERIES));
    const rows: { color: string; min: number; max: number }[] = [];
    for (let i = 0; i < visibleBuckets.length; i += tierSize) {
      const slice = visibleBuckets.slice(i, i + tierSize);
      const counts = slice.map((b) => b.count);
      rows.push({ color: categoricalColor(rows.length), min: Math.min(...counts), max: Math.max(...counts) });
    }
    return rows;
  }, [visibleBuckets]);

  const handleWordClick = useCallback((word: Word) => {
    const text = word.text;
    setExcluded((current) =>
      current.some((existing) => existing.toLowerCase() === text.toLowerCase())
        ? current
        : [...current, text],
    );
  }, []);

  const restoreWord = useCallback((word: string) => {
    setExcluded((current) => current.filter((existing) => existing.toLowerCase() !== word.toLowerCase()));
  }, []);

  const clearExclusions = useCallback(() => setExcluded([]), []);

  const callbacks = useMemo(
    () => ({
      getWordColor: (word: Word) => colorByText.get(word.text) ?? categoricalColor(0),
      getWordTooltip: (word: Word) => `${word.text} (${formatCompactNumber(word.value)})`,
      onWordClick: handleWordClick,
    }),
    [colorByText, handleWordClick],
  );

  if (buckets.length === 0) {
    return <EmptyState icon={Cloud} title="No data" description="No words matched this widget's query yet." />;
  }

  const chart = (
    <div>
      <div className="relative h-[340px] w-full min-h-[280px]">
        {words.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">All words excluded for this session.</p>
            <button
              type="button"
              onClick={clearExclusions}
              className="text-xs font-medium text-primary hover:text-primary/90"
            >
              Restore all
            </button>
          </div>
        ) : (
          <ReactWordcloud words={words} callbacks={callbacks} options={WORDCLOUD_OPTIONS} maxWords={CLOUD_RENDER_LIMIT} minSize={[280, 240]} />
        )}
      </div>

      {excluded.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Excluded</span>
          {excluded.map((word) => (
            <button
              key={word}
              type="button"
              onClick={() => restoreWord(word)}
              title={`Restore “${word}”`}
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-background px-2 py-0.5 text-[11px] text-foreground hover:border-primary"
            >
              {word}
              <X size={11} strokeWidth={2} aria-hidden="true" />
            </button>
          ))}
          {excluded.length > 1 ? (
            <button
              type="button"
              onClick={clearExclusions}
              className="ml-1 text-[11px] text-muted-foreground hover:text-primary"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}

      {sorted.length > visibleBuckets.length && excluded.length === 0 ? (
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Showing the top {visibleBuckets.length} of {sorted.length} words by frequency — see the table view for the
          full list.
        </p>
      ) : null}

      {tiers.length > 1 ? (
        <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
          {tiers.map((tier, index) => (
            <li key={index} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: tier.color }} aria-hidden="true" />
              <span>
                {tier.min === tier.max
                  ? formatCompactNumber(tier.min)
                  : `${formatCompactNumber(tier.max)}–${formatCompactNumber(tier.min)}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  const table = (
    <ChartDataTable
      categoryHeader="Word"
      categories={sorted.map((b) => b.key)}
      series={[{ key: 'count', label: 'Count' }]}
      values={[sorted.map((b) => b.count)]}
    />
  );

  return <ChartViewToggle ariaLabel="Word cloud" chart={chart} table={table} />;
}
