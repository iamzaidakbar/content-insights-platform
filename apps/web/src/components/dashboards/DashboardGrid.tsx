import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { asInsightId, DASHBOARD_MAX_INSIGHTS, type DashboardInsightRef, type DashboardLayoutItem } from '@content-insights/shared';

import { removeDashboardInsight, setDashboardLayout } from '../../lib/dashboards-api';
import InsightTile from './InsightTile';
import {
  arrayMove,
  computeLayout,
  deriveOrder,
  GRID_COLUMNS,
  matchPreset,
  sameOrder,
  SIZE_PRESETS,
  type OrderedInsight,
  type SizePresetKey,
} from './layout-engine';

interface DashboardGridProps {
  dashboardId: string;
  insights: DashboardInsightRef[];
  layout: DashboardLayoutItem[];
  canManage: boolean;
  onAddInsight?: () => void;
}

// The lightweight custom layout: a fixed GRID_COLUMNS-wide CSS grid, tiles placed in plain
// document order with an explicit gridColumn/gridRow span per its size preset, reordered by
// swapping array position via pointer events on each tile's own drag handle. Considered
// react-grid-layout / @dnd-kit instead — passed on both: with a hard cap of 3 tiles there's no
// free-form overlap-avoidance or virtualized-drag-list problem left for a library to earn its
// ~30-50kb; a few dozen lines of array-swap + CSS spans covers reorder+resize completely and
// stays trivial to reason about.
export default function DashboardGrid({ dashboardId, insights, layout, canManage, onAddInsight }: DashboardGridProps) {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<OrderedInsight[]>(() => deriveOrder(insights, layout));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const orderRef = useRef(order);
  const dragStartOrderRef = useRef<OrderedInsight[] | null>(null);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    // Resync from the server's own insights/layout whenever they change (an insight
    // added/removed elsewhere, a successful layout save echoing back) — but never while a
    // drag is actively in flight, or the resync would fight the user's own pointer.
    if (draggingId) return;
    setOrder(deriveOrder(insights, layout));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resync only on server-provided insights/layout; `draggingId` is read, not a resync trigger
  }, [insights, layout]);

  const layoutMutation = useMutation({
    mutationFn: (nextOrder: OrderedInsight[]) => setDashboardLayout(dashboardId, computeLayout(nextOrder)),
    onSuccess: (dashboard) => queryClient.setQueryData(['dashboard', dashboardId], dashboard),
  });

  const removeMutation = useMutation({
    mutationFn: (insightId: string) => removeDashboardInsight(dashboardId, insightId),
    onSuccess: (dashboard) => queryClient.setQueryData(['dashboard', dashboardId], dashboard),
  });

  function persist(nextOrder: OrderedInsight[], previous: OrderedInsight[]) {
    setOrder(nextOrder);
    if (sameOrder(nextOrder, previous)) return;
    layoutMutation.mutate(nextOrder, { onError: () => setOrder(previous) });
  }

  function handleResize(insightId: string, preset: SizePresetKey) {
    const previous = order;
    const next = previous.map((item) => (item.insightId === insightId ? { ...item, ...SIZE_PRESETS[preset] } : item));
    persist(next, previous);
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>, insightId: string) {
    if (!canManage) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartOrderRef.current = order;
    setDraggingId(insightId);
  }

  // Hit-tests whatever's visually under the pointer via elementFromPoint (unaffected by
  // pointer capture, which only redirects *event dispatch*, not page hit-testing) rather than
  // computing sibling midpoints by hand — simplest correct way to answer "which tile is the
  // user currently dragging over" on a wrapping CSS grid.
  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;
    const el = document.elementFromPoint(event.clientX, event.clientY);
    const overTile = el?.closest<HTMLElement>('[data-tile-id]');
    const overId = overTile?.dataset.tileId;
    if (!overId || overId === draggingId) return;
    setOrder((current) => {
      const fromIndex = current.findIndex((item) => item.insightId === draggingId);
      const toIndex = current.findIndex((item) => item.insightId === overId);
      if (fromIndex === -1 || toIndex === -1) return current;
      return arrayMove(current, fromIndex, toIndex);
    });
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const previous = dragStartOrderRef.current;
    dragStartOrderRef.current = null;
    setDraggingId(null);
    if (previous) {
      // orderRef is guaranteed current here: pointerup is a distinct browser event dispatched
      // after the pointermove(s) that produced the final order, so React has already
      // committed and effect-synced orderRef by the time this fires.
      persist(orderRef.current, previous);
    }
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`, gridAutoRows: '220px' }}>
      {order.map((item) => (
        <div
          key={item.insightId}
          data-tile-id={item.insightId}
          style={{ gridColumn: `span ${item.w}`, gridRow: `span ${item.h}` }}
          className={draggingId === item.insightId ? 'opacity-60' : ''}
        >
          <InsightTile
            insightRef={{ insightId: asInsightId(item.insightId), insightName: item.insightName, chartType: item.chartType }}
            canManage={canManage}
            sizePreset={matchPreset(item.w, item.h)}
            onResize={(preset) => handleResize(item.insightId, preset)}
            onRemove={() => removeMutation.mutate(item.insightId)}
            dragHandleProps={
              canManage
                ? {
                    onPointerDown: (event) => handlePointerDown(event, item.insightId),
                    onPointerMove: handlePointerMove,
                    onPointerUp: handlePointerUp,
                    onPointerCancel: handlePointerUp,
                  }
                : undefined
            }
          />
        </div>
      ))}

      {canManage && onAddInsight && order.length < DASHBOARD_MAX_INSIGHTS ? (
        <button
          type="button"
          onClick={onAddInsight}
          style={{ gridColumn: `span ${SIZE_PRESETS.small.w}`, gridRow: `span ${SIZE_PRESETS.small.h}` }}
          className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--border)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          <Plus size={22} />
          <span className="text-sm font-medium">Add insight</span>
        </button>
      ) : null}
    </div>
  );
}
