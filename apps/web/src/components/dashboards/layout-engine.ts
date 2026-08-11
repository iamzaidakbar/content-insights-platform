import type { ChartType, DashboardInsightRef, DashboardLayoutItem, DashboardLayoutItemInput } from '@content-insights/shared';

// A DASHBOARD_MAX_INSIGHTS cap of 3 makes a full drag-and-drop grid library overkill — this
// is the lightweight custom layout the brief asks to prefer instead: a fixed GRID_COLUMNS-wide
// CSS grid, a couple of fixed size presets standing in for "resize," and reordering by
// swapping array position (see InsightTile's drag handle + DashboardGrid's pointer handlers).
export const GRID_COLUMNS = 6;

export const SIZE_PRESETS = {
  small: { w: 2, h: 1 },
  medium: { w: 3, h: 1 },
  large: { w: 6, h: 2 },
} as const;
export type SizePresetKey = keyof typeof SIZE_PRESETS;
export const SIZE_PRESET_ORDER: SizePresetKey[] = ['small', 'medium', 'large'];

const DEFAULT_SIZE = SIZE_PRESETS.medium;

export interface OrderedInsight {
  insightId: string;
  insightName: string;
  chartType: ChartType;
  w: number;
  h: number;
}

export function matchPreset(w: number, h: number): SizePresetKey | undefined {
  return SIZE_PRESET_ORDER.find((key) => SIZE_PRESETS[key].w === w && SIZE_PRESETS[key].h === h);
}

// Initial tile order: insights with an existing layout row are sorted by (y, x) — the order
// the last drag/resize left them in. Anything newly attached without a layout row yet (e.g.
// just added via AddInsightModal, or a dangling row already dropped server-side) is appended
// at the end in Dashboard.insights' own (attach) order.
export function deriveOrder(insights: DashboardInsightRef[], layout: DashboardLayoutItem[]): OrderedInsight[] {
  const layoutById = new Map(layout.map((item) => [item.insightId, item]));
  const withLayout = insights.filter((ref) => layoutById.has(ref.insightId));
  const withoutLayout = insights.filter((ref) => !layoutById.has(ref.insightId));
  withLayout.sort((a, b) => {
    const la = layoutById.get(a.insightId);
    const lb = layoutById.get(b.insightId);
    return (la?.y ?? 0) - (lb?.y ?? 0) || (la?.x ?? 0) - (lb?.x ?? 0);
  });
  return [...withLayout, ...withoutLayout].map((ref) => {
    const existing = layoutById.get(ref.insightId);
    return {
      insightId: ref.insightId,
      insightName: ref.insightName,
      chartType: ref.chartType,
      w: existing?.w ?? DEFAULT_SIZE.w,
      h: existing?.h ?? DEFAULT_SIZE.h,
    };
  });
}

// Deterministic left-to-right, top-to-bottom packing on a GRID_COLUMNS-wide grid — mirrors
// what the CSS grid already does visually when tiles render in this same order with these
// same spans (DashboardGrid uses plain document order + `gridColumn`/`gridRow` spans, never
// manual x/y placement), so the persisted x/y stay meaningful bookkeeping without rendering
// ever depending on them being exactly right.
export function computeLayout(order: OrderedInsight[]): DashboardLayoutItemInput[] {
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  const layout: DashboardLayoutItemInput[] = [];
  for (const item of order) {
    if (cursorX > 0 && cursorX + item.w > GRID_COLUMNS) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    layout.push({ insightId: item.insightId, x: cursorX, y: cursorY, w: item.w, h: item.h });
    cursorX += item.w;
    rowHeight = Math.max(rowHeight, item.h);
  }
  return layout;
}

export function arrayMove<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return list;
  const next = list.slice();
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return list;
  next.splice(toIndex, 0, moved);
  return next;
}

export function sameOrder(a: OrderedInsight[], b: OrderedInsight[]): boolean {
  return a.length === b.length && a.every((item, index) => item.insightId === b[index]?.insightId);
}
