import type { ComponentType } from 'react';
import { BarChart3, Boxes, Cloud, Grid3x3, Network, Radar, Waves } from 'lucide-react';

import type { ChartType } from '@content-insights/shared';

interface ChartTypeMeta {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

// One entry per CHART_TYPES value (insight.ts) — kept as its own lookup (rather than inline
// in each call site) since both the insight picker and the dashboard grid need the same
// icon+label pairing.
// eslint-disable-next-line react-refresh/only-export-components -- shared lookup genuinely needed alongside the component (InsightTile/InsightPickerList read it directly), same accepted pattern as AuthContext's useAuth export
export const CHART_TYPE_META: Record<ChartType, ChartTypeMeta> = {
  bar: { label: 'Bar chart', icon: BarChart3 },
  wordCloud: { label: 'Word cloud', icon: Cloud },
  heatMap: { label: 'Heat map', icon: Grid3x3 },
  streamChart: { label: 'Stream chart', icon: Waves },
  treeMap: { label: 'Tree map', icon: Boxes },
  radar: { label: 'Radar', icon: Radar },
  relationship: { label: 'Relationship', icon: Network },
};

interface ChartTypeIconProps {
  type: ChartType;
  size?: number;
  className?: string;
}

export default function ChartTypeIcon({ type, size = 16, className }: ChartTypeIconProps) {
  const Icon = CHART_TYPE_META[type].icon;
  // exactOptionalPropertyTypes: lucide's own `className?: string` rejects an explicit
  // `undefined` — spread it in only when actually provided, rather than always naming the key.
  return <Icon size={size} strokeWidth={1.75} {...(className !== undefined ? { className } : {})} />;
}
