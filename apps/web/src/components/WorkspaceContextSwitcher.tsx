import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import type { User } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import { getApiErrorMessage } from '../lib/api-client';
import { fetchGroups } from '../lib/groups-api';
import { fetchProjects } from '../lib/projects-api';
import { setCurrentGroup, setCurrentProject } from '../lib/users-api';

function isAssignmentActiveNow(
  assignment: { startDate?: string | null; endDate?: string | null },
  now: Date = new Date(),
): boolean {
  const start = assignment.startDate ? new Date(assignment.startDate) : null;
  const end = assignment.endDate ? new Date(assignment.endDate) : null;
  return (!start || start <= now) && (!end || end >= now);
}

const SELECT_CLASS =
  'h-8 max-w-[11rem] truncate rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)]';

export default function WorkspaceContextSwitcher() {
  const { user, permissions, updateUser } = useAuth();
  const isAppAdmin = permissions.includes('*');

  const projectsQuery = useQuery({
    queryKey: ['projects-options'],
    queryFn: () => fetchProjects(1),
    staleTime: 5 * 60_000,
  });
  const groupsQuery = useQuery({
    queryKey: ['groups-options'],
    queryFn: () => fetchGroups(1),
    staleTime: 5 * 60_000,
  });

  const projects = projectsQuery.data?.items ?? [];
  const allGroups = groupsQuery.data?.items ?? [];
  const myGroupIds = new Set(
    (user?.roleAssignments ?? [])
      .filter((assignment) => assignment.groupId !== null && isAssignmentActiveNow(assignment))
      .map((assignment) => assignment.groupId as string),
  );
  const groupOptions = isAppAdmin ? allGroups : allGroups.filter((group) => myGroupIds.has(group.id));

  const projectMutation = useMutation({
    mutationFn: setCurrentProject,
    onSuccess: (updated: User) => updateUser(updated),
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to switch project.')),
  });
  const groupMutation = useMutation({
    mutationFn: setCurrentGroup,
    onSuccess: (updated: User) => updateUser(updated),
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to switch group.')),
  });

  return (
    <div className="hidden items-center gap-1.5 sm:flex">
      <select
        value={user?.currentProjectId ?? ''}
        onChange={(event) => projectMutation.mutate(event.target.value || null)}
        aria-label="Current project"
        className={SELECT_CLASS}
      >
        <option value="">All projects</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <select
        value={user?.currentGroupId ?? ''}
        onChange={(event) => groupMutation.mutate(event.target.value || null)}
        aria-label="Current group"
        className={SELECT_CLASS}
      >
        <option value="">No group</option>
        {groupOptions.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
    </div>
  );
}
