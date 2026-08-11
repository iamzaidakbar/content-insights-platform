import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { asRoleId, type Group, type UserSummary } from '@content-insights/shared';

import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { getApiErrorMessage } from '../lib/api-client';
import { fetchRoles } from '../lib/roles-api';
import { APPLICATION_ADMIN_ROLE_NAME } from '../lib/scoped-permissions';
import { assignUserRole, searchUsers } from '../lib/users-api';
import Button from './ui/Button';
import { Input, Select } from './ui/Input';
import Modal from './ui/Modal';

const DEBOUNCE_MS = 300;

interface AddMemberModalProps {
  group: Group;
  onClose: () => void;
}

// "Add member" is really "create a role assignment scoped to this group" — Group.members
// has no direct write endpoint of its own; it's a read-model the API derives from every
// User.roleAssignments that references this group (see Group.members's own comment in
// @content-insights/shared). Application Admin is deliberately excluded from the role
// picker below: it can only ever be assigned at global scope (validateRoleAssignmentInput,
// apps/api/src/lib/permissions.ts) — grant it from Admin → Role Assignments instead, which
// offers "All (org-wide)" as a scope.
export default function AddMemberModal({ group, onClose }: AddMemberModalProps) {
  const queryClient = useQueryClient();

  const [rawQuery, setRawQuery] = useState('');
  const debouncedQuery = useDebouncedValue(rawQuery, DEBOUNCE_MS);
  const trimmedQuery = debouncedQuery.trim();

  const [selectedUser, setSelectedUser] = useState<UserSummary | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['user-search', trimmedQuery],
    queryFn: () => searchUsers(trimmedQuery),
    enabled: trimmedQuery.length > 0,
  });

  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  // Application Admin can never be scoped to a single group (it's always global) — omitted
  // here rather than shown-but-disabled, since there's no valid way to select it in this form.
  const roles = (rolesQuery.data ?? []).filter((role) => role.name !== APPLICATION_ADMIN_ROLE_NAME);

  const addMemberMutation = useMutation({
    mutationFn: () => {
      if (!selectedUser || !selectedRoleId) {
        throw new Error('Select a user and a role.');
      }
      return assignUserRole(selectedUser.id, {
        roleId: asRoleId(selectedRoleId),
        groupId: group.id,
        startDate: startDate || null,
        endDate: endDate || null,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['group', group.id] });
      void queryClient.invalidateQueries({ queryKey: ['groups-list'] });
      toast.success('Member added.');
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to add member.')),
    meta: { skipToast: true },
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
    <Modal
      open
      onClose={onClose}
      title="Add member"
      description={`To ${group.name}`}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={addMemberMutation.isPending}>
            Add member
          </Button>
        </>
      }
    >
      <div>
        <label htmlFor="member-search" className="block text-sm font-medium text-[var(--text-secondary)]">
          Search users by email
        </label>
        <Input
          id="member-search"
          type="text"
          autoFocus
          value={rawQuery}
          onChange={(event) => {
            setRawQuery(event.target.value);
            setSelectedUser(null);
          }}
          placeholder="e.g. jane@example.com"
          className="mt-1"
        />

        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
          {usersQuery.isLoading ? (
            <li className="px-2 py-1.5 text-xs text-[var(--text-muted)]">Searching…</li>
          ) : usersQuery.isError ? (
            <li className="px-2 py-1.5 text-xs text-[var(--red)]">Unable to search users.</li>
          ) : trimmedQuery.length === 0 ? null : searchResults.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-[var(--text-muted)]">No matching users.</li>
          ) : (
            searchResults.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => setSelectedUser(candidate)}
                  className={`w-full rounded-[var(--radius-button)] px-2 py-1.5 text-left text-sm transition-colors ${
                    selectedUser?.id === candidate.id
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {candidate.email}
                </button>
              </li>
            ))
          )}
        </ul>

        {selectedUser ? (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Selected: <span className="text-[var(--text-primary)]">{selectedUser.email}</span>
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <label htmlFor="member-role" className="block text-sm font-medium text-[var(--text-secondary)]">
          Role
        </label>
        <Select
          id="member-role"
          value={selectedRoleId}
          onChange={(event) => setSelectedRoleId(event.target.value)}
          className="mt-1"
        >
          <option value="">Select a role…</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Need to grant Application Admin instead? That role is always global — use Admin → Role Assignments.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="member-start" className="block text-sm font-medium text-[var(--text-secondary)]">
            Start date <span className="text-[var(--text-muted)]">(optional)</span>
          </label>
          <Input
            id="member-start"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label htmlFor="member-end" className="block text-sm font-medium text-[var(--text-secondary)]">
            End date <span className="text-[var(--text-muted)]">(optional)</span>
          </label>
          <Input
            id="member-end"
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      {error ? <p className="mt-4 text-sm text-[var(--red)]">{error}</p> : null}
    </Modal>
  );
}
