import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';

import { useAuth } from '../auth/AuthContext';
import ChartTypeIcon from '../components/dashboards/ChartTypeIcon';
import CreateDashboardModal from '../components/dashboards/CreateDashboardModal';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import { getApiErrorMessage } from '../lib/api-client';
import { fetchDashboards } from '../lib/dashboards-api';
import { formatDate } from '../lib/format';
import { fetchGroups } from '../lib/groups-api';
import { fetchProjects } from '../lib/projects-api';
import { fetchRoles } from '../lib/roles-api';
import { hasScopedPermission } from '../lib/scoped-permissions';

export default function DashboardsPage() {
  const { user, permissions } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [projectFilter, setProjectFilter] = useState('');
  const [page, setPage] = useState(1);

  const dashboardsQuery = useQuery({
    queryKey: ['dashboards-list', projectFilter, page],
    queryFn: () => fetchDashboards(projectFilter || undefined, page),
  });
  const dashboards = dashboardsQuery.data?.items ?? [];
  const showEmptyState = !dashboardsQuery.isLoading && !dashboardsQuery.isError && dashboards.length === 0;

  const canManageOrgWide = permissions.includes('dashboards:manage') || permissions.includes('*');
  const groupsQuery = useQuery({ queryKey: ['groups-options'], queryFn: () => fetchGroups(), staleTime: 5 * 60_000 });
  const projectsQuery = useQuery({ queryKey: ['projects-options'], queryFn: () => fetchProjects(), staleTime: 5 * 60_000 });
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles, enabled: !canManageOrgWide });
  const allGroups = groupsQuery.data?.items ?? [];
  const allProjects = projectsQuery.data?.items ?? [];
  const roles = rolesQuery.data ?? [];
  const groupOptions = canManageOrgWide
    ? allGroups
    : allGroups.filter((group) => user && hasScopedPermission(group, roles, user.id, permissions, 'dashboards:manage'));
  const canCreate = groupOptions.length > 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Dashboards</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Up to three saved insights each, arranged and resized per dashboard.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {allProjects.length > 0 ? (
            <select
              value={projectFilter}
              onChange={(event) => {
                setProjectFilter(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            >
              <option value="">All projects</option>
              {allProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          ) : null}
          {canCreate ? (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              New dashboard
            </button>
          ) : null}
        </div>
      </div>

      {dashboardsQuery.isError ? (
        <p className="mt-6 text-sm text-[var(--red)]">
          {getApiErrorMessage(dashboardsQuery.error, 'Unable to load dashboards.')}
        </p>
      ) : null}

      {showEmptyState ? (
        <div className="mt-6">
          <EmptyState
            icon={LayoutDashboard}
            title="No dashboards yet"
            description={canCreate ? 'Import up to three saved insights to build one.' : undefined}
          />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dashboardsQuery.isLoading
            ? Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="h-32 animate-pulse rounded-[var(--radius-card)] bg-[var(--bg-hover)]" />
              ))
            : dashboards.map((dashboard) => (
                <Link
                  key={dashboard.id}
                  to={`/dashboards/${dashboard.id}`}
                  className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] p-5 transition-colors hover:border-[var(--accent)]"
                >
                  <div className="flex items-center gap-1.5">
                    {dashboard.insights.length === 0 ? (
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-button)] text-[var(--accent)]"
                        style={{ backgroundColor: 'var(--accent-soft)' }}
                      >
                        <LayoutDashboard size={16} />
                      </span>
                    ) : (
                      dashboard.insights.map((insight) => (
                        <span
                          key={insight.insightId}
                          title={insight.insightName}
                          className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-button)] text-[var(--accent)]"
                          style={{ backgroundColor: 'var(--accent-soft)' }}
                        >
                          <ChartTypeIcon type={insight.chartType} size={15} />
                        </span>
                      ))
                    )}
                  </div>
                  <h3 className="mt-3 truncate text-sm font-semibold text-[var(--text-primary)]">{dashboard.name}</h3>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {dashboard.insights.length} insight{dashboard.insights.length === 1 ? '' : 's'} · Updated{' '}
                    {formatDate(dashboard.updatedAt)}
                  </p>
                </Link>
              ))}
        </div>
      )}

      {dashboardsQuery.data && dashboardsQuery.data.totalPages > 1 ? (
        <div className="mt-4 flex justify-end">
          <Pagination page={page} totalPages={dashboardsQuery.data.totalPages} onPageChange={setPage} />
        </div>
      ) : null}

      {isCreating ? (
        <CreateDashboardModal groupOptions={groupOptions} projectOptions={allProjects} onClose={() => setIsCreating(false)} />
      ) : null}
    </div>
  );
}
