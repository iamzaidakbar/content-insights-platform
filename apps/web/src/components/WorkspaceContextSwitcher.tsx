import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { User } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import { getApiErrorMessage } from '../lib/api-client';
import { fetchAllGroups } from '../lib/groups-api';
import { fetchAllProjects } from '../lib/projects-api';
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
  'h-8 max-w-[7rem] truncate rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:opacity-60 sm:max-w-[11rem]';

export default function WorkspaceContextSwitcher() {
  const { user, permissions, updateUser } = useAuth();
  const isAppAdmin = permissions.includes('*');
  const [pendingProjectId, setPendingProjectId] = useState<string | null | undefined>(undefined);
  const [pendingGroupId, setPendingGroupId] = useState<string | null | undefined>(undefined);

  const projectsQuery = useQuery({
    queryKey: ['projects-all'],
    queryFn: fetchAllProjects,
    staleTime: 5 * 60_000,
  });
  const groupsQuery = useQuery({
    queryKey: ['groups-all'],
    queryFn: fetchAllGroups,
    staleTime: 5 * 60_000,
  });

  const projects = projectsQuery.data ?? [];
  const allGroups = groupsQuery.data ?? [];
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
    onSettled: () => setPendingProjectId(undefined),
  });
  const groupMutation = useMutation({
    mutationFn: setCurrentGroup,
    onSuccess: (updated: User) => updateUser(updated),
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to switch group.')),
    onSettled: () => setPendingGroupId(undefined),
  });

  const selectedProjectId = pendingProjectId !== undefined ? pendingProjectId : (user?.currentProjectId ?? null);
  const selectedGroupId = pendingGroupId !== undefined ? pendingGroupId : (user?.currentGroupId ?? null);
  const selectedGroupMissing =
    selectedGroupId !== null && !groupOptions.some((group) => group.id === selectedGroupId);

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={selectedProjectId ?? ''}
        onChange={(event) => {
          const next = event.target.value || null;
          setPendingProjectId(next);
          projectMutation.mutate(next);
        }}
        disabled={projectMutation.isPending}
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
        value={selectedGroupId ?? ''}
        onChange={(event) => {
          const next = event.target.value || null;
          setPendingGroupId(next);
          groupMutation.mutate(next);
        }}
        disabled={groupMutation.isPending}
        aria-label="Current group"
        className={SELECT_CLASS}
      >
        <option value="">No group</option>
        {selectedGroupMissing ? (
          <option value={selectedGroupId}>Current group</option>
        ) : null}
        {groupOptions.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
    </div>
  );
}
