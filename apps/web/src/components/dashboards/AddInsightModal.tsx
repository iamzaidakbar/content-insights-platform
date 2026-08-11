import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Dashboard } from '@content-insights/shared';

import { getApiErrorMessage } from '../../lib/api-client';
import { updateDashboard } from '../../lib/dashboards-api';
import InsightPickerList from './InsightPickerList';

interface AddInsightModalProps {
  dashboardId: string;
  currentInsightIds: string[];
  remainingSlots: number;
  onClose: () => void;
  onAdded: (dashboard: Dashboard) => void;
}

// Reuses the same InsightPickerList as CreateDashboardModal's step 1, just wrapped in its
// own single-step modal chrome and capped at whatever slots remain on this dashboard —
// updateDashboard's insightIds is a bulk replace, so the request carries the full desired
// set (current + newly picked), not just the additions.
export default function AddInsightModal({ dashboardId, currentInsightIds, remainingSlots, onClose, onAdded }: AddInsightModalProps) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function toggleInsight(insightId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(insightId)) {
        next.delete(insightId);
      } else {
        next.add(insightId);
      }
      return next;
    });
  }

  const addMutation = useMutation({
    mutationFn: () => updateDashboard(dashboardId, { insightIds: [...currentInsightIds, ...Array.from(selectedIds)] }),
    onSuccess: (dashboard) => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard', dashboardId] });
      onAdded(dashboard);
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to add insight to this dashboard.')),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Add insight</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {remainingSlots} slot{remainingSlots === 1 ? '' : 's'} remaining on this dashboard.
        </p>

        <div className="mt-4">
          <InsightPickerList
            selectedIds={selectedIds}
            onToggle={toggleInsight}
            excludeInsightIds={currentInsightIds}
            maxSelectable={remainingSlots}
          />
        </div>

        {error ? <p className="mt-3 text-sm text-[var(--red)]">{error}</p> : null}

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--text-muted)]">
            {selectedIds.size}/{remainingSlots} selected
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => addMutation.mutate()}
              disabled={selectedIds.size === 0 || addMutation.isPending}
              className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {addMutation.isPending ? 'Adding…' : 'Add to dashboard'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
