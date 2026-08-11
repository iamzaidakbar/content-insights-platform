import { useState, type ReactNode } from 'react';

interface ChartViewToggleProps {
  chart: ReactNode;
  table: ReactNode;
  ariaLabel: string;
}

const VIEWS = ['chart', 'table'] as const;
type ChartView = (typeof VIEWS)[number];

// Every Bar/Radar/HeatMap chart ships this — the dataviz skill's accessibility pass
// requires a table-view twin for every chart, not just a visual/color-based render (see
// references/anti-patterns.md: "No table view / color-only encoding on a continuous scale").
export default function ChartViewToggle({ chart, table, ariaLabel }: ChartViewToggleProps) {
  const [view, setView] = useState<ChartView>('chart');

  return (
    <div>
      <div className="mb-2 flex justify-end" role="group" aria-label={`${ariaLabel} view`}>
        <div className="flex items-center gap-0.5 rounded-[var(--radius-button)] border border-[var(--border)] p-0.5">
          {VIEWS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={view === candidate}
              onClick={() => setView(candidate)}
              className="rounded-[calc(var(--radius-button)-2px)] px-2 py-1 text-[11px] font-medium capitalize transition-colors"
              style={
                view === candidate
                  ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              {candidate}
            </button>
          ))}
        </div>
      </div>
      {view === 'chart' ? chart : table}
    </div>
  );
}
