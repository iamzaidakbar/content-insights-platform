import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';

import { useAuth } from '../../auth/AuthContext';
import { getApiErrorMessage } from '../../lib/api-client';
import { fetchInsights } from '../../lib/insights-api';
import EmptyState from '../EmptyState';
import Pagination from '../Pagination';
import ChartTypeIcon, { CHART_TYPE_META } from './ChartTypeIcon';

const SKELETON_ROW_COUNT = 4;

interface InsightPickerListProps {
  selectedIds: Set<string>;
  onToggle: (insightId: string) => void;
  // Insights already attached to the dashboard being edited — hidden entirely rather than
  // shown-disabled, since re-selecting one would be a no-op the server would 409 on anyway.
  excludeInsightIds?: string[];
  // The create-dashboard flow passes DASHBOARD_MAX_INSIGHTS; the "add to existing dashboard"
  // flow passes the remaining slot count (DASHBOARD_MAX_INSIGHTS - already-attached count) —
  // this component only ever enforces whatever cap its caller hands it.
  maxSelectable: number;
}

// Pure list UI (fetch + pagination + checkboxes) — deliberately not a modal itself, so both
// CreateDashboardModal (step 1 of its wizard) and AddInsightModal can embed it inside their
// own modal chrome without nesting two overlays.
export default function InsightPickerList({ selectedIds, onToggle, excludeInsightIds, maxSelectable }: InsightPickerListProps) {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const insightsQuery = useQuery({ queryKey: ['insights-picker', page], queryFn: () => fetchInsights(page) });

  const excluded = new Set(excludeInsightIds ?? []);
  const items = (insightsQuery.data?.items ?? []).filter((insight) => !excluded.has(insight.id));
  const atCap = selectedIds.size >= maxSelectable;
  const showEmptyState = !insightsQuery.isLoading && !insightsQuery.isError && items.length === 0;

  return (
    <div>
      {insightsQuery.isError ? (
        <p className="mb-2 text-sm text-[var(--red)]">
          {getApiErrorMessage(insightsQuery.error, 'Unable to load insights.')}
        </p>
      ) : null}

      <div className="max-h-72 space-y-1 overflow-y-auto rounded-[var(--radius-input)] border border-[var(--border)] p-1.5">
        {insightsQuery.isLoading
          ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
              <div key={index} className="h-11 animate-pulse rounded-[var(--radius-button)] bg-[var(--bg-hover)]" />
            ))
          : items.map((insight) => {
              const isSelected = selectedIds.has(insight.id);
              const isDisabled = !isSelected && atCap;
              return (
                <label
                  key={insight.id}
                  title={isDisabled ? `A dashboard can have at most ${maxSelectable} insights` : undefined}
                  className={`flex items-center gap-3 rounded-[var(--radius-button)] px-2 py-2 text-sm transition-colors ${
                    isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={isDisabled}
                    onChange={() => onToggle(insight.id)}
                    className="accent-[var(--accent)]"
                  />
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-button)] text-[var(--accent)]"
                    style={{ backgroundColor: 'var(--accent-soft)' }}
                  >
                    <ChartTypeIcon type={insight.chartType} size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--text-primary)]">{insight.name}</span>
                    <span className="block truncate text-xs text-[var(--text-secondary)]">
                      {CHART_TYPE_META[insight.chartType].label}
                      {insight.ownerId !== user?.id ? ` · ${insight.ownerEmail}` : ''}
                    </span>
                  </span>
                </label>
              );
            })}

        {showEmptyState ? (
          <EmptyState icon={BarChart3} title="No insights available" description="Save an insight from Articles or Search first." />
        ) : null}
      </div>

      {insightsQuery.data && insightsQuery.data.totalPages > 1 ? (
        <div className="mt-3 flex justify-end">
          <Pagination page={page} totalPages={insightsQuery.data.totalPages} onPageChange={setPage} />
        </div>
      ) : null}
    </div>
  );
}
