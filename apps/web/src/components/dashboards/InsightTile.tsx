import {
  Component,
  Suspense,
  lazy,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, GripVertical, MoreVertical, Table2, Trash2 } from 'lucide-react';

import type { DashboardInsightRef, Insight } from '@content-insights/shared';

import { useClickOutside } from '../../hooks/useClickOutside';
import { getApiErrorMessage } from '../../lib/api-client';
import { fetchInsight, fetchInsightData, type InsightDataResponse } from '../../lib/insights-api';
import { CHART_TYPE_META } from './ChartTypeIcon';
import { resolveChartLoader } from './chart-loader';
import { SIZE_PRESET_ORDER, type SizePresetKey } from './layout-engine';
import UnderlyingArticlesTable from './UnderlyingArticlesTable';

export interface DragHandleProps {
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
}

// Catches a chart component that throws while rendering (bad data shape, a half-finished
// sibling-built component, etc.) so one broken insight tile can't take down the whole
// dashboard grid — mirrors the app-level ErrorBoundary's contract but sized for a single tile.
class TileErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  override state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Insight chart failed to render', error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-40 items-center justify-center rounded-[var(--radius-input)] border border-dashed border-[var(--border)] px-4 text-center text-xs text-[var(--text-muted)]">
          This chart couldn&apos;t be displayed.
        </div>
      );
    }
    return this.props.children;
  }
}

function ChartBody({ insightRef, insight, data }: { insightRef: DashboardInsightRef; insight: Insight; data: InsightDataResponse }) {
  const loader = resolveChartLoader(insightRef.chartType);
  // Memoized on the loader function's own identity (stable across renders — it comes from
  // the module-level import.meta.glob map) so `lazy()` is only ever called once per chart
  // type; calling it fresh every render would produce a new component identity each time and
  // force Suspense to remount/refetch the chunk continuously.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loader is referentially stable per chartType, see above
  const ChartComponent = useMemo(() => (loader ? lazy(loader) : null), [insightRef.chartType]);

  if (!ChartComponent) {
    // The sibling phase hasn't landed this chart type's component yet (or never will for a
    // typo'd/retired type) — a graceful placeholder, never a crash, per the brief.
    const meta = CHART_TYPE_META[insightRef.chartType];
    const Icon = meta.icon;
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-[var(--radius-input)] border border-dashed border-[var(--border)] px-4 text-center text-[var(--text-muted)]">
        <Icon size={22} strokeWidth={1.5} />
        <span className="text-xs">{meta.label} view isn&apos;t available yet.</span>
      </div>
    );
  }

  const buckets = data.aggregations[0]?.buckets ?? [];
  return (
    <TileErrorBoundary>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-[var(--radius-input)] bg-[var(--bg-hover)]" />}>
        <ChartComponent insight={insight} total={data.total} buckets={buckets} aggregations={data.aggregations} />
      </Suspense>
    </TileErrorBoundary>
  );
}

interface InsightTileProps {
  insightRef: DashboardInsightRef;
  canManage: boolean;
  sizePreset: SizePresetKey | undefined;
  onResize: (preset: SizePresetKey) => void;
  onRemove: () => void;
  // Omitted (no grip rendered) when the viewer can't manage this dashboard. Widened to
  // `| undefined` (not just `?`) — exactOptionalPropertyTypes: DashboardGrid passes the
  // result of a ternary (`canManage ? {...} : undefined`), which types as `T | undefined`,
  // not an absent key (see EmptyState's own `description` prop for the same pattern).
  dragHandleProps?: DragHandleProps | undefined;
}

export default function InsightTile({ insightRef, canManage, sizePreset, onResize, onRemove, dragHandleProps }: InsightTileProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setIsMenuOpen(false));

  const insightQuery = useQuery({
    queryKey: ['insight', insightRef.insightId],
    queryFn: () => fetchInsight(insightRef.insightId),
  });
  const dataQuery = useQuery({
    queryKey: ['insight-data', insightRef.insightId],
    queryFn: () => fetchInsightData(insightRef.insightId),
  });

  const meta = CHART_TYPE_META[insightRef.chartType];
  const HeaderIcon = meta.icon;

  return (
    <div className="flex h-full flex-col rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {dragHandleProps ? (
            <button
              type="button"
              {...dragHandleProps}
              title="Drag to reorder"
              className="touch-none cursor-grab rounded-[var(--radius-button)] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] active:cursor-grabbing"
            >
              <GripVertical size={14} />
            </button>
          ) : null}
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-button)] text-[var(--accent)]"
            style={{ backgroundColor: 'var(--accent-soft)' }}
          >
            <HeaderIcon size={14} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{insightRef.insightName}</h3>
            <p className="truncate text-xs text-[var(--text-secondary)]">{meta.label}</p>
          </div>
        </div>

        {canManage ? (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
              aria-label="Insight actions"
              className="rounded-[var(--radius-button)] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <MoreVertical size={16} />
            </button>
            {isMenuOpen ? (
              <div className="absolute right-0 z-10 mt-1 w-44 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-sm shadow-lg">
                <p className="px-1 pb-1.5 text-xs font-medium text-[var(--text-muted)]">Size</p>
                <div className="flex gap-1 pb-2">
                  {SIZE_PRESET_ORDER.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        onResize(key);
                        setIsMenuOpen(false);
                      }}
                      className={`flex-1 rounded-[var(--radius-button)] border px-1.5 py-1 text-xs capitalize transition-colors ${
                        sizePreset === key
                          ? 'border-[var(--accent)] text-[var(--accent)]'
                          : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      {key}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onRemove();
                    setIsMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-[var(--radius-button)] px-2 py-1.5 text-left text-[var(--red)] hover:bg-[var(--bg-hover)]"
                >
                  <Trash2 size={14} /> Remove from dashboard
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex-1">
        {insightQuery.isLoading || dataQuery.isLoading ? (
          <div className="h-40 animate-pulse rounded-[var(--radius-input)] bg-[var(--bg-hover)]" />
        ) : insightQuery.isError ? (
          <p className="py-8 text-center text-sm text-[var(--red)]">
            {getApiErrorMessage(insightQuery.error, 'Unable to load this insight.')}
          </p>
        ) : dataQuery.isError ? (
          <p className="py-8 text-center text-sm text-[var(--red)]">
            {getApiErrorMessage(dataQuery.error, "Unable to load this insight's data.")}
          </p>
        ) : insightQuery.data && dataQuery.data ? (
          <ChartBody insightRef={insightRef} insight={insightQuery.data} data={dataQuery.data} />
        ) : null}
      </div>

      {/* "View dashboard with underlying document tables where relevant" — always offered
          (every insight has a well-defined matching-article set via its own sourceFilters),
          collapsed by default; most useful for date/time-oriented charts but not gated to
          them, since gating on chart type would hide it for a legitimately relevant one this
          form heuristic doesn't happen to name. */}
      {insightQuery.data ? (
        <div className="mt-3 border-t border-[var(--border)] pt-2">
          <button
            type="button"
            onClick={() => setShowTable((open) => !open)}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <Table2 size={13} />
            Underlying articles
            {showTable ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {showTable ? (
            <div className="mt-2">
              <UnderlyingArticlesTable filters={insightQuery.data.sourceFilters} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
