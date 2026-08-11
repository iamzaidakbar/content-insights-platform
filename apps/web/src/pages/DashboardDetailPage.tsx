import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, MoreVertical, Pencil, Trash2 } from 'lucide-react';

import { DASHBOARD_MAX_INSIGHTS } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import AddInsightModal from '../components/dashboards/AddInsightModal';
import DashboardGrid from '../components/dashboards/DashboardGrid';
import EmptyState from '../components/EmptyState';
import { useClickOutside } from '../hooks/useClickOutside';
import { getApiErrorMessage } from '../lib/api-client';
import { deleteDashboard, fetchDashboard, updateDashboard } from '../lib/dashboards-api';
import { INPUT_CLASSNAME } from '../lib/form-styles';
import { fetchGroup } from '../lib/groups-api';
import { fetchRoles } from '../lib/roles-api';
import { hasScopedPermission } from '../lib/scoped-permissions';

export default function DashboardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, permissions } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isAddingInsight, setIsAddingInsight] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setIsMenuOpen(false));

  const dashboardQuery = useQuery({
    queryKey: ['dashboard', id],
    queryFn: () => {
      if (!id) throw new Error('Missing dashboard id.');
      return fetchDashboard(id);
    },
    enabled: id !== undefined,
  });
  const dashboard = dashboardQuery.data;

  const canManageOrgWide = permissions.includes('dashboards:manage') || permissions.includes('*');
  const groupQuery = useQuery({
    queryKey: ['group', dashboard?.groupId],
    queryFn: () => fetchGroup(dashboard!.groupId),
    enabled: !canManageOrgWide && dashboard !== undefined,
  });
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles, enabled: !canManageOrgWide });
  const canManage =
    canManageOrgWide ||
    (user && groupQuery.data
      ? hasScopedPermission(groupQuery.data, rolesQuery.data ?? [], user.id, permissions, 'dashboards:manage')
      : false);

  const renameMutation = useMutation({
    mutationFn: (name: string) => {
      if (!id) throw new Error('Missing dashboard id.');
      return updateDashboard(id, { name });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['dashboard', id], updated);
      setIsRenaming(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!id) throw new Error('Missing dashboard id.');
      return deleteDashboard(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboards-list'] });
      navigate('/dashboards', { replace: true });
    },
  });

  if (!id) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-12">
        <p className="text-sm text-[var(--red)]">Invalid dashboard id.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      <Link to="/dashboards" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        &larr; Back to dashboards
      </Link>

      <div className="mt-2 flex items-start justify-between gap-3">
        {isRenaming ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (nameDraft.trim()) renameMutation.mutate(nameDraft.trim());
            }}
          >
            <input
              autoFocus
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              className={INPUT_CLASSNAME}
            />
            <button
              type="submit"
              disabled={renameMutation.isPending}
              className="shrink-0 rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setIsRenaming(false)}
              className="shrink-0 rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
          </form>
        ) : (
          <h1 className="min-w-0 truncate text-2xl font-semibold text-[var(--text-primary)]">
            {dashboard?.name ?? 'Dashboard'}
          </h1>
        )}

        {canManage && dashboard && !isRenaming ? (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
              aria-label="Dashboard actions"
              className="rounded-[var(--radius-button)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            >
              <MoreVertical size={18} />
            </button>
            {isMenuOpen ? (
              <div className="absolute right-0 z-10 mt-1 w-44 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-1 text-sm shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setNameDraft(dashboard.name);
                    setIsRenaming(true);
                    setIsMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-[var(--radius-button)] px-2 py-1.5 text-left text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <Pencil size={14} /> Rename
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    if (window.confirm('Delete this dashboard? This cannot be undone.')) {
                      deleteMutation.mutate();
                    }
                  }}
                  className="flex w-full items-center gap-2 rounded-[var(--radius-button)] px-2 py-1.5 text-left text-[var(--red)] hover:bg-[var(--bg-hover)]"
                >
                  <Trash2 size={14} /> Delete dashboard
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {dashboardQuery.isError ? (
        <p className="mt-6 text-sm text-[var(--red)]">
          {getApiErrorMessage(dashboardQuery.error, 'Unable to load this dashboard.')}
        </p>
      ) : null}

      {dashboardQuery.isLoading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-48 animate-pulse rounded-[var(--radius-card)] bg-[var(--bg-hover)]" />
          ))}
        </div>
      ) : dashboard && dashboard.insights.length === 0 ? (
        canManage ? (
          <button
            type="button"
            onClick={() => setIsAddingInsight(true)}
            className="mt-10 flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--border)] py-16 text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <LayoutDashboard size={28} />
            <span className="text-sm font-medium">Add an insight</span>
          </button>
        ) : (
          <EmptyState icon={LayoutDashboard} title="No insights yet" />
        )
      ) : dashboard ? (
        <div className="mt-6">
          <DashboardGrid
            dashboardId={dashboard.id}
            insights={dashboard.insights}
            layout={dashboard.layout}
            canManage={canManage}
            onAddInsight={() => setIsAddingInsight(true)}
          />
        </div>
      ) : null}

      {isAddingInsight && dashboard ? (
        <AddInsightModal
          dashboardId={dashboard.id}
          currentInsightIds={dashboard.insights.map((insight) => insight.insightId)}
          remainingSlots={DASHBOARD_MAX_INSIGHTS - dashboard.insights.length}
          onClose={() => setIsAddingInsight(false)}
          onAdded={(updated) => {
            queryClient.setQueryData(['dashboard', id], updated);
            setIsAddingInsight(false);
          }}
        />
      ) : null}
    </div>
  );
}
