import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Project, UserSummary } from '@content-insights/shared';

import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { getApiErrorMessage } from '../lib/api-client';
import { addProjectMember } from '../lib/projects-api';
import { fetchRoles } from '../lib/roles-api';
import { searchUsers } from '../lib/users-api';

const DEBOUNCE_MS = 300;

interface AddMemberModalProps {
  project: Project;
  onClose: () => void;
}

export default function AddMemberModal({ project, onClose }: AddMemberModalProps) {
  const queryClient = useQueryClient();

  const [rawQuery, setRawQuery] = useState('');
  const debouncedQuery = useDebouncedValue(rawQuery, DEBOUNCE_MS);
  const trimmedQuery = debouncedQuery.trim();

  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const usersQuery = useQuery({
    queryKey: ['user-search', trimmedQuery],
    queryFn: () => searchUsers(trimmedQuery),
    enabled: trimmedQuery.length > 0,
  });

  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const roles = rolesQuery.data ?? [];

  const addMemberMutation = useMutation({
    mutationFn: () => {
      if (!selectedUser || !selectedRoleId) {
        throw new Error('Select a user and a role.');
      }
      return addProjectMember(project.id, { userId: selectedUser.id, roleId: selectedRoleId });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['project', project.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to add member.')),
  });

  function handleSubmit() {
    setError(null);
    if (!selectedUser) {
      setError('Select a user first.');
      return;
    }
    if (!selectedRoleId) {
      setError('Select a role.');
      return;
    }
    addMemberMutation.mutate();
  }

  const searchResults = usersQuery.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-md border border-slate-700 bg-slate-900 p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-100">Add member</h2>

        <div className="mt-4">
          <label htmlFor="member-search" className="block text-sm font-medium text-slate-300">
            Search users by email
          </label>
          <input
            id="member-search"
            type="text"
            autoFocus
            value={rawQuery}
            onChange={(event) => {
              setRawQuery(event.target.value);
              setSelectedUser(null);
            }}
            placeholder="e.g. jane@example.com"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          />

          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {usersQuery.isLoading ? (
              <li className="px-2 py-1.5 text-xs text-slate-500">Searching…</li>
            ) : usersQuery.isError ? (
              <li className="px-2 py-1.5 text-xs text-red-400">Unable to search users.</li>
            ) : trimmedQuery.length === 0 ? null : searchResults.length === 0 ? (
              <li className="px-2 py-1.5 text-xs text-slate-500">No matching users.</li>
            ) : (
              searchResults.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedUser(candidate)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition ${
                      selectedUser?.id === candidate.id
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-300 hover:bg-slate-800/60'
                    }`}
                  >
                    {candidate.email}
                  </button>
                </li>
              ))
            )}
          </ul>

          {selectedUser ? (
            <p className="mt-2 text-xs text-slate-400">
              Selected: <span className="text-slate-100">{selectedUser.email}</span>
            </p>
          ) : null}
        </div>

        <div className="mt-4">
          <label htmlFor="member-role" className="block text-sm font-medium text-slate-300">
            Role
          </label>
          <select
            id="member-role"
            value={selectedRoleId}
            onChange={(event) => setSelectedRoleId(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500"
          >
            <option value="">Select a role…</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-100 transition hover:border-slate-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={addMemberMutation.isPending}
            className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {addMemberMutation.isPending ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </div>
    </div>
  );
}
