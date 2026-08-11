import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, MoreVertical, Pencil, Trash2 } from 'lucide-react';

import { DASHBOARD_MAX_INSIGHTS } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import AddInsightModal from '../components/dashboards/AddInsightModal';
import DashboardGrid from '../components/dashboards/DashboardGrid';
import EmptyState from '../components/EmptyState';
import Alert from '../components/ui/Alert';
import Breadcrumbs from '../components/ui/Breadcrumbs';
import Button from '../components/ui/Button';
import IconButton from '../components/ui/IconButton';
import { Input } from '../components/ui/Input';
import PageHeader, { PageBody } from '../components/ui/PageHeader';
import Skeleton from '../components/ui/Skeleton';
import { useClickOutside } from '../hooks/useClickOutside';
import { getApiErrorMessage } from '../lib/api-client';
import { deleteDashboard, fetchDashboard, updateDashboard } from '../lib/dashboards-api';
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
      <PageBody width="xl">
        <Alert variant="error">Invalid dashboard id.</Alert>
      </PageBody>
    );
  }

  const headerTitle = dashboard?.name ?? 'Dashboard';

  return (
    <PageBody width="xl">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs items={[{ label: 'Dashboards', to: '/dashboards' }, { label: headerTitle }]} />
        }
        title={isRenaming ? 'Rename dashboard' : headerTitle}
        actions={
          isRenaming ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (nameDraft.trim()) renameMutation.mutate(nameDraft.trim());
              }}
            >
              <Input
                autoFocus
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                className="h-9 max-w-xs py-1.5"
              />
              <Button type="submit" size="sm" loading={renameMutation.isPending}>
                Save
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsRenaming(false)}>
                Cancel
              </Button>
            </form>
          ) : canManage && dashboard ? (
            <div className="relative shrink-0" ref={menuRef}>
              <IconButton
                icon={MoreVertical}
                label="Dashboard actions"
                onClick={() => setIsMenuOpen((open) => !open)}
              />
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
                    className="flex w-full items-center gap-2 rounded-[var(--radius-button)] px-2 py-1.5 text-left text-[var(--error)] hover:bg-[var(--bg-hover)]"
                  >
                    <Trash2 size={14} /> Delete dashboard
                  </button>
                </div>
              ) : null}
            </div>
          ) : null
        }
      />

      {dashboardQuery.isError ? (
        <Alert variant="error" className="mb-4">
          {getApiErrorMessage(dashboardQuery.error, 'Unable to load this dashboard.')}
        </Alert>
      ) : null}

      {dashboardQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-48 w-full" />
          ))}
        </div>
      ) : dashboard && dashboard.insights.length === 0 ? (
        canManage ? (
          <button
            type="button"
            onClick={() => setIsAddingInsight(true)}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed border-[var(--border)] py-14 text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <LayoutDashboard size={28} />
            <span className="text-sm font-medium">Add an insight</span>
          </button>
        ) : (
          <EmptyState icon={LayoutDashboard} title="No insights yet" />
        )
      ) : dashboard ? (
        <DashboardGrid
          dashboardId={dashboard.id}
          insights={dashboard.insights}
          layout={dashboard.layout}
          canManage={canManage}
          onAddInsight={() => setIsAddingInsight(true)}
        />
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
    </PageBody>
  );
}
