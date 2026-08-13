import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Dashboard } from '@content-insights/shared';

import { getApiErrorMessage } from '../../lib/api-client';
import { updateDashboard } from '../../lib/dashboards-api';
import Button from '../ui/button';
import Modal from '../ui/Modal';
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
    <Modal
      open
      onClose={onClose}
      title="Add insight"
      description={`${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} remaining on this dashboard.`}
      size="md"
      footer={
        <>
          <span className="mr-auto text-xs text-muted-foreground">
            {selectedIds.size}/{remainingSlots} selected
          </span>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => addMutation.mutate()}
            disabled={selectedIds.size === 0}
            loading={addMutation.isPending}
          >
            Add to dashboard
          </Button>
        </>
      }
    >
      <InsightPickerList
        selectedIds={selectedIds}
        onToggle={toggleInsight}
        excludeInsightIds={currentInsightIds}
        maxSelectable={remainingSlots}
      />
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
    </Modal>
  );
}
