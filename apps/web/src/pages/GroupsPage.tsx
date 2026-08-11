import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';

import { useAuth } from '../auth/AuthContext';
import EmptyState from '../components/EmptyState';
import { getApiErrorMessage } from '../lib/api-client';
import { formatDate } from '../lib/format';
import { INPUT_CLASSNAME } from '../lib/form-styles';
import { createGroup, fetchGroups } from '../lib/groups-api';

const SKELETON_ROW_COUNT = 4;

function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--border)]">
      <td className="py-3 pr-4">
        <div className="h-4 w-40 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
      <td className="py-3">
        <div className="h-4 w-28 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
    </tr>
  );
}

function NewGroupModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createGroup({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups-list'] });
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to create group.')),
    meta: { skipToast: true },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Group name is required.');
      return;
    }
    createMutation.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">New group</h2>
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="group-name" className="block text-sm font-medium text-[var(--text-secondary)]">
              Name
            </label>
            <input
              id="group-name"
              type="text"
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={`mt-1 ${INPUT_CLASSNAME}`}
            />
          </div>

          <div>
            <label htmlFor="group-description" className="block text-sm font-medium text-[var(--text-secondary)]">
              Description <span className="text-[var(--text-muted)]">(optional)</span>
            </label>
            <input
              id="group-description"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={`mt-1 ${INPUT_CLASSNAME}`}
            />
          </div>

          {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createMutation.isPending ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function GroupsPage() {
  const { permissions } = useAuth();
  const canManageGroups = permissions.includes('groups:manage') || permissions.includes('*');
  const [isCreating, setIsCreating] = useState(false);

  const groupsQuery = useQuery({ queryKey: ['groups-list'], queryFn: () => fetchGroups() });

  const groups = groupsQuery.data?.items ?? [];
  const showEmptyState = !groupsQuery.isLoading && !groupsQuery.isError && groups.length === 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Groups</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Groups in your organization.</p>
        </div>
        {canManageGroups ? (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            New group
          </button>
        ) : null}
      </div>

      {groupsQuery.isError ? (
        <p className="mt-6 text-sm text-[var(--red)]">
          {getApiErrorMessage(groupsQuery.error, 'Unable to load groups.')}
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
              <th className="pb-2 pr-4 font-medium">Name</th>
              <th className="pb-2 pr-4 font-medium">Members</th>
              <th className="pb-2 pr-4 font-medium">Projects</th>
              <th className="pb-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {groupsQuery.isLoading
              ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => <SkeletonRow key={index} />)
              : groups.map((group) => (
                  <tr key={group.id} className="h-11 border-b border-[var(--border)]">
                    <td className="py-3 pr-4 text-[var(--text-primary)]">
                      <Link to={`/groups/${group.id}`} className="hover:text-[var(--accent)]">
                        {group.name}
                      </Link>
                    </td>
                    <td className="py-3 pr-4 text-[var(--text-secondary)]">{group.members.length}</td>
                    <td className="py-3 pr-4 text-[var(--text-secondary)]">{group.dataAccess.projectIds.length}</td>
                    <td className="py-3 text-[var(--text-secondary)]">{formatDate(group.createdAt)}</td>
                  </tr>
                ))}
          </tbody>
        </table>

        {showEmptyState ? (
          <EmptyState
            icon={Users}
            title="No groups yet"
            description={canManageGroups ? 'Create a group to start organizing articles and members.' : undefined}
            action={
              canManageGroups ? (
                <button
                  type="button"
                  onClick={() => setIsCreating(true)}
                  className="flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--border)] px-4 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
                >
                  Create your first group
                </button>
              ) : undefined
            }
          />
        ) : null}
      </div>

      {isCreating ? <NewGroupModal onClose={() => setIsCreating(false)} /> : null}
    </div>
  );
}
