import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, UserCog, X } from 'lucide-react';

import { asGroupId, asRoleId, type Group, type Role, type RoleAssignment, type User } from '@content-insights/shared';

import { useAuth } from '../../auth/AuthContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { getApiErrorMessage } from '../../lib/api-client';
import { formatDate } from '../../lib/format';
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
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '../ui/Card';
import { Input, Select } from '../ui/Input';
import Modal from '../ui/Modal';
import Skeleton from '../ui/Skeleton';
import { Table, TBody, TD, TH, THead, TR } from '../ui/Table';

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
            className="text-[var(--text-muted)] hover:text-[var(--error)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={11} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => endMutation.mutate()}
            disabled={endMutation.isPending}
            title="End this assignment now"
            className="font-medium text-[var(--text-muted)] hover:text-[var(--error)] disabled:cursor-not-allowed disabled:opacity-50"
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
    <Modal
      open
      onClose={onClose}
      title="Assign role"
      description={`To ${targetUser.email}`}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <span title={disabledReason ?? undefined}>
            <Button
              onClick={handleSubmit}
              disabled={!roleId || !roleAllowed || !scopeAllowed}
              loading={assignMutation.isPending}
            >
              Assign role
            </Button>
          </span>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="assign-role" className="block text-sm font-medium text-[var(--text-secondary)]">
            Role
          </label>
          <Select
            id="assign-role"
            value={roleId}
            onChange={(event) => {
              setRoleId(event.target.value);
              setScope('');
            }}
            className="mt-1"
          >
            <option value="">Select a role…</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label htmlFor="assign-scope" className="block text-sm font-medium text-[var(--text-secondary)]">
            Scope
          </label>
          <Select
            id="assign-scope"
            value={isAppAdmin ? '' : scope}
            disabled={isAppAdmin}
            onChange={(event) => setScope(event.target.value)}
            className="mt-1"
          >
            {canUseGlobalScope || isAppAdmin ? <option value="">All (org-wide)</option> : null}
            {assignableGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
          {isAppAdmin ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">Application Admin is always granted at global scope.</p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="assign-start" className="block text-sm font-medium text-[var(--text-secondary)]">
              Start date <span className="text-[var(--text-muted)]">(optional)</span>
            </label>
            <Input
              id="assign-start"
              type="date"
              value={startDate}
              disabled={isAppAdmin}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="assign-end" className="block text-sm font-medium text-[var(--text-secondary)]">
              End date <span className="text-[var(--text-muted)]">(optional)</span>
            </label>
            <Input
              id="assign-end"
              type="date"
              value={endDate}
              disabled={isAppAdmin}
              onChange={(event) => setEndDate(event.target.value)}
              className="mt-1"
            />
          </div>
        </div>
        {isAppAdmin ? (
          <p className="-mt-1 text-xs text-[var(--text-muted)]">Application Admin access can never be time-bound.</p>
        ) : null}

        {error ? <Alert variant="error">{error}</Alert> : null}
      </div>
    </Modal>
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Role Assignments</CardTitle>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
          Grant a role scoped to a group, or globally (“All”) — dates are optional and, except for Application Admin,
          may bound when an assignment starts or automatically lapses.
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        <Input
          type="text"
          value={rawQuery}
          onChange={(event) => {
            setRawQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search by email…"
          className="max-w-xs"
          aria-label="Search users by email"
        />

        {usersQuery.isError ? (
          <Alert variant="error">{getApiErrorMessage(usersQuery.error, 'Unable to load users.')}</Alert>
        ) : null}
        {rolesQuery.isError ? (
          <Alert variant="error">{getApiErrorMessage(rolesQuery.error, 'Unable to load roles.')}</Alert>
        ) : null}

        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Email</TH>
              <TH>Assignments</TH>
              <TH>&nbsp;</TH>
            </TR>
          </THead>
          <TBody>
            {usersQuery.isLoading
              ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                  <TR key={index}>
                    <TD>
                      <Skeleton className="h-4 w-40" />
                    </TD>
                    <TD>
                      <Skeleton className="h-4 w-56" />
                    </TD>
                    <TD>
                      <Skeleton className="h-4 w-16" />
                    </TD>
                  </TR>
                ))
              : users.map((orgUser) => (
                  <TR key={orgUser.id} className="align-top">
                    <TD>{orgUser.email}</TD>
                    <TD>
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
                    </TD>
                    <TD>
                      <button
                        type="button"
                        onClick={() => setAssigningTo(orgUser)}
                        className="flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-hover)]"
                      >
                        <Plus size={13} />
                        Assign
                      </button>
                    </TD>
                  </TR>
                ))}
          </TBody>
        </Table>

        {showEmptyState ? <EmptyState icon={UserCog} title="No users found" /> : null}

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
      </CardBody>
    </Card>
  );
}
