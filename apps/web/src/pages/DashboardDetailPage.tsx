import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, MoreVertical, Pencil, Trash2 } from 'lucide-react';

import { DASHBOARD_MAX_INSIGHTS } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import AddInsightModal from '../components/dashboards/AddInsightModal';
import DashboardGrid from '../components/dashboards/DashboardGrid';
import EmptyState from '../components/EmptyState';
import Alert from '../components/ui/alert';
import Breadcrumbs from '../components/ui/Breadcrumbs';
import Button from '../components/ui/button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Input } from '../components/ui/input';
import PageHeader, { PageBody } from '../components/ui/PageHeader';
import Skeleton from '../components/ui/skeleton';
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
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

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
      <PageBody>
        <Alert variant="error">Invalid dashboard id.</Alert>
      </PageBody>
    );
  }

  const headerTitle = dashboard?.name ?? 'Dashboard';

  return (
    <PageBody>
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Dashboard actions">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setNameDraft(dashboard.name);
                    setIsRenaming(true);
                  }}
                >
                  <Pencil /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setIsDeleteOpen(true)}>
                  <Trash2 /> Delete dashboard
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-14 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
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

      <ConfirmDialog
        open={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete this dashboard?"
        description="This cannot be undone."
        confirmLabel="Delete dashboard"
        destructive
        loading={deleteMutation.isPending}
      />
    </PageBody>
  );
}
