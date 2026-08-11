import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, UserCog, X } from 'lucide-react';

import { asGroupId, asRoleId, type Group, type Role, type RoleAssignment, type User } from '@content-insights/shared';

import { useAuth } from '../../auth/AuthContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { getApiErrorMessage } from '../../lib/api-client';
import { formatDate } from '../../lib/format';
import { INPUT_CLASSNAME } from '../../lib/form-styles';
import { fetchAllGroups } from '../../lib/groups-api';
import { fetchRoles } from '../../lib/roles-api';
import {
  APPLICATION_ADMIN_ROLE_NAME,
  canAssignRole,
  hasScopedPermission,
  isRoleAssignmentActive,
} from '../../lib/scoped-permissions';
import { assignUserRole, fetchOrgUsers, revokeUserRoleAssignment, updateRoleAssignmentEndDate } from '../../lib/users-api';
import EmptyState from '../EmptyState';
import Pagination from '../Pagination';
import { SETTINGS_SELECT_CLASSNAME, SettingsSection } from '../settings/SettingsSection';

const DEBOUNCE_MS = 300;
const SKELETON_ROW_COUNT = 5;

// ---------------------------------------------------------------------------------------
// Rewritten from a flat "one org-wide role per member" picker (pre-pivot) into the full
// role-assignment console: every assignment now carries its own scope (a specific Group, or
// "All"/global) plus optional start/end dates (User.roleAssignments), so managing them needs
// more than a single <select>. GroupDetailPage's own member list still shows a read-only
// per-group roster (Group.members is a derived view of the same underlying data) and offers
// its own "Add member" for the common in-context case; this section is the one place that
// can also grant/end a GLOBAL ("All") scope assignment, which no single group's page could
// meaningfully expose.
// ---------------------------------------------------------------------------------------

function scopeLabel(groupId: string | null, groupNameById: Map<string, string>): string {
  if (groupId === null) {
    return 'All (org-wide)';
  }
  return groupNameById.get(groupId) ?? 'Unknown group';
}

function AssignmentChip({
  targetUser,
  assignment,
  groupNameById,
}: {
  targetUser: User;
  assignment: RoleAssignment;
  groupNameById: Map<string, string>;
}) {
  const queryClient = useQueryClient();
  const isAppAdmin = assignment.roleName === APPLICATION_ADMIN_ROLE_NAME;
  const active = isRoleAssignmentActive(assignment);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['org-users'] });
  }

  const endMutation = useMutation({
    mutationFn: () => updateRoleAssignmentEndDate(targetUser.id, assignment.id, new Date().toISOString()),
    onSuccess: () => {
      invalidate();
      toast.success('Assignment ended.');
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => revokeUserRoleAssignment(targetUser.id, assignment.id),
    onSuccess: () => {
      invalidate();
      toast.success('Assignment removed.');
    },
  });

  return (
    <div
      className="flex items-center gap-1.5 rounded-[var(--radius-tag)] px-2 py-1 text-xs"
      style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
      data-testid="role-assignment-chip"
    >
      <span className={active ? '' : 'opacity-50 line-through'}>
        <span className="font-medium">{assignment.roleName}</span> · {scopeLabel(assignment.groupId, groupNameById)}
        {assignment.startDate || assignment.endDate ? (
          <span className="ml-1 text-[var(--text-muted)]">
            ({assignment.startDate ? formatDate(assignment.startDate) : 'open'} –{' '}
            {assignment.endDate ? formatDate(assignment.endDate) : 'open'})
          </span>
        ) : null}
      </span>
      {active ? (
        isAppAdmin ? (
          <button
            type="button"
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
            title="Application Admin access is always global and can't be time-bound — remove it to revoke immediately"
            className="text-[var(--text-muted)] hover:text-[var(--red)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={11} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => endMutation.mutate()}
            disabled={endMutation.isPending}
            title="End this assignment now"
            className="font-medium text-[var(--text-muted)] hover:text-[var(--red)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            End
          </button>
        )
      ) : null}
    </div>
  );
}

function AssignRoleModal({
  targetUser,
  roles,
  groups,
  onClose,
}: {
  targetUser: User;
  roles: Role[];
  groups: Group[];
  onClose: () => void;
}) {
  const { user: actor, permissions } = useAuth();
  const queryClient = useQueryClient();

  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState(''); // '' => All (org-wide)
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedRole = roles.find((role) => role.id === roleId);
  const isAppAdmin = selectedRole?.name === APPLICATION_ADMIN_ROLE_NAME;
  const chosenGroupId = isAppAdmin ? null : scope || null;

  const canUseGlobalScope = permissions.includes('*') || permissions.includes('roles:assign');
  const assignableGroups = groups.filter((group) =>
    actor ? hasScopedPermission(group, roles, actor.id, permissions, 'roles:assign') : false,
  );
  const scopeAllowed = chosenGroupId === null ? canUseGlobalScope : assignableGroups.some((g) => g.id === chosenGroupId);
  const roleAllowed = selectedRole
    ? canAssignRole(actor?.roleAssignments ?? [], permissions, selectedRole.name, chosenGroupId)
    : true;

  const assignMutation = useMutation({
    mutationFn: () =>
      assignUserRole(targetUser.id, {
        roleId: asRoleId(roleId),
        groupId: chosenGroupId ? asGroupId(chosenGroupId) : null,
        startDate: isAppAdmin ? null : startDate || null,
        endDate: isAppAdmin ? null : endDate || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-users'] });
      toast.success('Role assigned.');
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to assign this role.')),
    meta: { skipToast: true },
  });

  let disabledReason: string | null = null;
  if (!roleId) {
    disabledReason = null;
  } else if (!roleAllowed) {
    disabledReason = 'Only an Application Admin can grant the Application Admin role.';
  } else if (!scopeAllowed) {
    disabledReason = "You don't have permission to assign roles in this scope.";
  }

  function handleSubmit() {
    setError(null);
    if (!roleId) {
      setError('Select a role.');
      return;
    }
    assignMutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Assign role</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          To <span className="text-[var(--text-primary)]">{targetUser.email}</span>
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="assign-role" className="block text-sm font-medium text-[var(--text-secondary)]">
              Role
            </label>
            <select
              id="assign-role"
              value={roleId}
              onChange={(event) => {
                setRoleId(event.target.value);
                setScope('');
              }}
              className={`mt-1 w-full ${SETTINGS_SELECT_CLASSNAME}`}
            >
              <option value="">Select a role…</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="assign-scope" className="block text-sm font-medium text-[var(--text-secondary)]">
              Scope
            </label>
            <select
              id="assign-scope"
              value={isAppAdmin ? '' : scope}
              disabled={isAppAdmin}
              onChange={(event) => setScope(event.target.value)}
              className={`mt-1 w-full ${SETTINGS_SELECT_CLASSNAME} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {canUseGlobalScope || isAppAdmin ? <option value="">All (org-wide)</option> : null}
              {assignableGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            {isAppAdmin ? (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Application Admin is always granted at global scope.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="assign-start" className="block text-sm font-medium text-[var(--text-secondary)]">
                Start date <span className="text-[var(--text-muted)]">(optional)</span>
              </label>
              <input
                id="assign-start"
                type="date"
                value={startDate}
                disabled={isAppAdmin}
                onChange={(event) => setStartDate(event.target.value)}
                className={`mt-1 w-full ${INPUT_CLASSNAME} disabled:cursor-not-allowed disabled:opacity-60`}
              />
            </div>
            <div>
              <label htmlFor="assign-end" className="block text-sm font-medium text-[var(--text-secondary)]">
                End date <span className="text-[var(--text-muted)]">(optional)</span>
              </label>
              <input
                id="assign-end"
                type="date"
                value={endDate}
                disabled={isAppAdmin}
                onChange={(event) => setEndDate(event.target.value)}
                className={`mt-1 w-full ${INPUT_CLASSNAME} disabled:cursor-not-allowed disabled:opacity-60`}
              />
            </div>
          </div>
          {isAppAdmin ? (
            <p className="-mt-2 text-xs text-[var(--text-muted)]">
              Application Admin access can never be time-bound.
            </p>
          ) : null}

          {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              Cancel
            </button>
            <span title={disabledReason ?? undefined}>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!roleId || !roleAllowed || !scopeAllowed || assignMutation.isPending}
                className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {assignMutation.isPending ? 'Assigning…' : 'Assign role'}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminMembersSection() {
  const [page, setPage] = useState(1);
  const [rawQuery, setRawQuery] = useState('');
  const debouncedQuery = useDebouncedValue(rawQuery, DEBOUNCE_MS);
  const [assigningTo, setAssigningTo] = useState<User | null>(null);

  const usersQuery = useQuery({
    queryKey: ['org-users', page, debouncedQuery],
    queryFn: () => fetchOrgUsers(page, debouncedQuery.trim() || undefined),
  });
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const groupsQuery = useQuery({ queryKey: ['groups-all'], queryFn: fetchAllGroups });

  const roles = rolesQuery.data ?? [];
  const groups = groupsQuery.data ?? [];
  const groupNameById = new Map<string, string>(groups.map((group) => [group.id, group.name]));
  const users = usersQuery.data?.items ?? [];
  const showEmptyState = !usersQuery.isLoading && !usersQuery.isError && users.length === 0;

  return (
    <SettingsSection
      title="Role Assignments"
      description="Grant a role scoped to a group, or globally (“All”) — dates are optional and, except for Application Admin, may bound when an assignment starts or automatically lapses."
    >
      <input
        type="text"
        value={rawQuery}
        onChange={(event) => {
          setRawQuery(event.target.value);
          setPage(1);
        }}
        placeholder="Search by email…"
        className={`max-w-xs ${INPUT_CLASSNAME}`}
        aria-label="Search users by email"
      />

      {usersQuery.isError ? (
        <p className="text-sm text-[var(--red)]">{getApiErrorMessage(usersQuery.error, 'Unable to load users.')}</p>
      ) : null}
      {rolesQuery.isError ? (
        <p className="text-sm text-[var(--red)]">{getApiErrorMessage(rolesQuery.error, 'Unable to load roles.')}</p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
              <th className="pb-2 pr-4 font-medium">Email</th>
              <th className="pb-2 pr-4 font-medium">Assignments</th>
              <th className="pb-2 font-medium">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {usersQuery.isLoading
              ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                  <tr key={index} className="border-b border-[var(--border)]">
                    <td className="py-3 pr-4">
                      <div className="h-4 w-40 animate-pulse rounded bg-[var(--bg-hover)]" />
                    </td>
                    <td className="py-3 pr-4">
                      <div className="h-4 w-56 animate-pulse rounded bg-[var(--bg-hover)]" />
                    </td>
                    <td className="py-3">
                      <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
                    </td>
                  </tr>
                ))
              : users.map((orgUser) => (
                  <tr key={orgUser.id} className="border-b border-[var(--border)] align-top">
                    <td className="py-3 pr-4 text-[var(--text-primary)]">{orgUser.email}</td>
                    <td className="py-3 pr-4">
                      {orgUser.roleAssignments.length === 0 ? (
                        <span className="text-xs text-[var(--text-muted)]">No role assignments</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {orgUser.roleAssignments.map((assignment) => (
                            <AssignmentChip
                              key={assignment.id}
                              targetUser={orgUser}
                              assignment={assignment}
                              groupNameById={groupNameById}
                            />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => setAssigningTo(orgUser)}
                        className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-hover)]"
                      >
                        <Plus size={13} />
                        Assign
                      </button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {showEmptyState ? <EmptyState icon={UserCog} title="No users found" /> : null}
      </div>

      {usersQuery.data && usersQuery.data.totalPages > 1 ? (
        <div className="flex justify-end">
          <Pagination page={page} totalPages={usersQuery.data.totalPages} onPageChange={setPage} />
        </div>
      ) : null}

      {assigningTo ? (
        <AssignRoleModal
          targetUser={assigningTo}
          roles={roles}
          groups={groups}
          onClose={() => setAssigningTo(null)}
        />
      ) : null}
    </SettingsSection>
  );
}
