import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { BarChart3, Pencil, Plus, Trash2 } from 'lucide-react';

import { EMPTY_FILTER_PANEL_STATE, type Insight } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import InsightBuilderModal from '../components/insights/InsightBuilderModal';
import { getApiErrorMessage } from '../lib/api-client';
import { fetchConcepts } from '../lib/concepts-api';
import { formatDate } from '../lib/format';
import { fetchGroups } from '../lib/groups-api';
import { CHART_TYPE_META } from '../lib/insight-chart-config';
import { deleteInsight, fetchInsights } from '../lib/insights-api';

const SKELETON_ROW_COUNT = 5;

function isAssignmentActiveNow(assignment: { startDate?: string | null; endDate?: string | null }, now: Date = new Date()): boolean {
  const start = assignment.startDate ? new Date(assignment.startDate) : null;
  const end = assignment.endDate ? new Date(assignment.endDate) : null;
  return (!start || start <= now) && (!end || end >= now);
}

function SkeletonRow() {
  return (
    <tr className="h-11 border-b border-[var(--border)]">
      <td className="py-3 pr-4">
        <div className="h-4 w-44 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-24 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-32 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
      <td className="py-3">
        <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
    </tr>
  );
}

export default function InsightsPage() {
  const { user, permissions } = useAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [editingInsight, setEditingInsight] = useState<Insight | null>(null);

  const isOrgAdmin = permissions.includes('org:admin') || permissions.includes('*');
  const isAppAdmin = permissions.includes('*');
  const currentProjectId = user?.currentProjectId ?? null;
  const currentGroupId = user?.currentGroupId ?? null;

  const insightsQuery = useQuery({ queryKey: ['insights-list', page], queryFn: () => fetchInsights(page) });
  const insights = insightsQuery.data?.items ?? [];
  const showEmptyState = !insightsQuery.isLoading && !insightsQuery.isError && insights.length === 0;

  // Same "own groups, or every group for an Application Admin" derivation ArticlesPage uses
  // to build SaveQueryModal's groupOptions — an insight always belongs to one of these.
  const groupsQuery = useQuery({ queryKey: ['groups-options'], queryFn: () => fetchGroups(1), staleTime: 5 * 60_000 });
  const allGroups = groupsQuery.data?.items ?? [];
  const myGroupIds = new Set(
    (user?.roleAssignments ?? [])
      .filter((assignment) => assignment.groupId !== null && isAssignmentActiveNow(assignment))
      .map((assignment) => assignment.groupId as string),
  );
  const groupOptions = useMemo(
    () => (isAppAdmin ? allGroups : allGroups.filter((group) => myGroupIds.has(group.id))).map((group) => ({ id: group.id, name: group.name })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- myGroupIds is rebuilt fresh every render from user.roleAssignments; keying off `user` (stable-ish reference from AuthContext) avoids an infinite-recompute loop from a brand-new Set every render.
    [allGroups, isAppAdmin, user],
  );

  const conceptsQuery = useQuery({
    queryKey: ['concepts', currentProjectId],
    queryFn: () => fetchConcepts(currentProjectId as string),
    enabled: currentProjectId !== null,
    staleTime: 5 * 60_000,
  });
  const concepts = conceptsQuery.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInsight(id),
    onSuccess: () => {
      toast.success('Insight deleted.');
      void queryClient.invalidateQueries({ queryKey: ['insights-list'] });
    },
    // Surfaces the server's own message verbatim — in particular the 409 INSIGHT_IN_USE
    // case ("used by one or more dashboards"), which the delete is deliberately blocked on
    // rather than cascaded (see insights-api.ts's own comment on deleteInsight).
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to delete this insight.')),
  });

  function handleDelete(insight: Insight) {
    if (window.confirm(`Delete "${insight.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(insight.id);
    }
  }

  function canManage(insight: Insight): boolean {
    return isOrgAdmin || insight.ownerId === user?.id;
  }

  const canCreate = groupOptions.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Insights</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Saved charts built from an Articles search — yours, and your groups&apos;.
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] bg-[var(--accent)] px-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            <Plus size={14} />
            New insight
          </button>
        ) : null}
      </div>

      {insightsQuery.isError ? (
        <p className="mt-6 text-sm text-[var(--red)]">{getApiErrorMessage(insightsQuery.error, 'Unable to load insights.')}</p>
      ) : null}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
              <th className="pb-2 pr-4 font-medium">Name</th>
              <th className="pb-2 pr-4 font-medium">Chart type</th>
              <th className="pb-2 pr-4 font-medium">Owner</th>
              <th className="pb-2 pr-4 font-medium">Last updated</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {insightsQuery.isLoading
              ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => <SkeletonRow key={index} />)
              : insights.map((insight) => (
                  <tr key={insight.id} className="h-11 border-b border-[var(--border)]">
                    <td className="py-3 pr-4">
                      <button
                        type="button"
                        onClick={() => setEditingInsight(insight)}
                        className="text-left font-medium text-[var(--text-primary)] hover:text-[var(--accent)]"
                        title="Open"
                      >
                        {insight.name}
                      </button>
                    </td>
                    <td className="py-3 pr-4 text-[var(--text-secondary)]">{CHART_TYPE_META[insight.chartType].label}</td>
                    <td className="py-3 pr-4 text-[var(--text-secondary)]">{insight.ownerEmail}</td>
                    <td className="py-3 pr-4 text-[var(--text-secondary)]">{formatDate(insight.updatedAt)}</td>
                    <td className="py-3">
                      {canManage(insight) ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingInsight(insight)}
                            aria-label={`Edit ${insight.name}`}
                            className="rounded-[var(--radius-button)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(insight)}
                            disabled={deleteMutation.isPending}
                            aria-label={`Delete ${insight.name}`}
                            className="rounded-[var(--radius-button)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--red)] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {showEmptyState ? (
          <EmptyState
            icon={BarChart3}
            title="No insights yet"
            description={canCreate ? 'Build a chart from an Articles search to see it here.' : undefined}
            action={
              canCreate ? (
                <button
                  type="button"
                  onClick={() => setIsCreating(true)}
                  className="flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--border)] px-4 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
                >
                  Create your first insight
                </button>
              ) : undefined
            }
          />
        ) : null}
      </div>

      {insightsQuery.data && insightsQuery.data.totalPages > 1 ? (
        <div className="mt-4 flex justify-end">
          <Pagination page={page} totalPages={insightsQuery.data.totalPages} onPageChange={setPage} />
        </div>
      ) : null}

      {isCreating ? (
        <InsightBuilderModal
          sourceFilters={EMPTY_FILTER_PANEL_STATE}
          groupOptions={groupOptions}
          defaultGroupId={currentGroupId}
          concepts={concepts}
          onClose={() => setIsCreating(false)}
        />
      ) : null}

      {editingInsight ? (
        <InsightBuilderModal
          sourceFilters={editingInsight.sourceFilters}
          groupOptions={groupOptions}
          concepts={concepts}
          existingInsight={editingInsight}
          onClose={() => setEditingInsight(null)}
        />
      ) : null}
    </div>
  );
}
