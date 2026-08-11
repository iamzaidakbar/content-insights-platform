import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronUp, Lock, Users } from 'lucide-react';

import { asGroupId, type GroupMemberSummary } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import AddMemberModal from '../components/AddMemberModal';
import EmptyState from '../components/EmptyState';
import GroupDataAccessModal from '../components/GroupDataAccessModal';
import { getApiErrorMessage } from '../lib/api-client';
import { formatDate } from '../lib/format';
import { fetchGroup } from '../lib/groups-api';
import { fetchRoles } from '../lib/roles-api';
import { APPLICATION_ADMIN_ROLE_NAME, hasScopedPermission, isRoleAssignmentActive } from '../lib/scoped-permissions';
import { fetchOrgUsers, revokeUserRoleAssignment, updateRoleAssignmentEndDate } from '../lib/users-api';

const SKELETON_ROW_COUNT = 3;

function SkeletonRow() {
  return (
    <tr className="border-b border-[var(--border)]">
      <td className="py-3 pr-4">
        <div className="h-4 w-40 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-20 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
      <td className="py-3 pr-4">
        <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
      <td className="py-3">
        <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------------------
// Group.members is a derived read-model (userId/email/roleId/roleName/dates only — no
// roleAssignment id, see GroupMemberSummary's own comment in @content-insights/shared), so
// ending/removing one specific assignment needs that id, which only the full User record
// carries. There is no GET /users/:id — the only way to fetch it is the paginated roster
// (GET /users?page=..., gated on users:read), so this is resolved lazily, on demand, only
// once "Manage" is expanded for a given row (never eagerly for the whole list). A scoped
// User Group Admin without an org-wide users:read grant will see the permission error
// surfaced below rather than a crash — Admin → Role Assignments is the fallback path for
// them (it already has the full User record in hand from its own roster fetch).
// ---------------------------------------------------------------------------------------
function MemberRow({
  groupId,
  member,
  canManage,
}: {
  groupId: string;
  member: GroupMemberSummary;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [isManaging, setIsManaging] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['user-detail-by-email', member.userEmail],
    queryFn: () => fetchOrgUsers(1, member.userEmail),
    enabled: isManaging,
  });

  const targetUser = detailQuery.data?.items.find(
    (candidate) => candidate.email.toLowerCase() === member.userEmail.toLowerCase(),
  );
  const assignment = targetUser?.roleAssignments.find(
    (candidate) => candidate.groupId === groupId && candidate.roleId === member.roleId,
  );

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['group', groupId] });
    void queryClient.invalidateQueries({ queryKey: ['user-detail-by-email', member.userEmail] });
  }

  const endMutation = useMutation({
    mutationFn: () => {
      if (!targetUser || !assignment) {
        throw new Error('Assignment not resolved yet.');
      }
      return updateRoleAssignmentEndDate(targetUser.id, assignment.id, new Date().toISOString());
    },
    onSuccess: () => {
      invalidate();
      toast.success('Assignment ended.');
      setIsManaging(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => {
      if (!targetUser || !assignment) {
        throw new Error('Assignment not resolved yet.');
      }
      return revokeUserRoleAssignment(targetUser.id, assignment.id);
    },
    onSuccess: () => {
      invalidate();
      toast.success('Member removed.');
      setIsManaging(false);
    },
  });

  const isAppAdmin = member.roleName === APPLICATION_ADMIN_ROLE_NAME;
  const active = isRoleAssignmentActive(member);

  return (
    <>
      <tr className="h-11 border-b border-[var(--border)]">
        <td className="py-3 pr-4 text-[var(--text-primary)]">{member.userEmail}</td>
        <td className="py-3 pr-4 text-[var(--text-secondary)]">{member.roleName}</td>
        <td className="py-3 pr-4 text-xs text-[var(--text-secondary)]">
          {member.startDate ? formatDate(member.startDate) : 'Open'} –{' '}
          {member.endDate ? formatDate(member.endDate) : 'Open'}
          {!active ? <span className="ml-1.5 text-[var(--text-muted)]">(ended)</span> : null}
        </td>
        {canManage ? (
          <td className="py-3">
            <button
              type="button"
              onClick={() => setIsManaging((current) => !current)}
              className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Manage
              {isManaging ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          </td>
        ) : null}
      </tr>
      {canManage && isManaging ? (
        <tr className="border-b border-[var(--border)] bg-[var(--bg-hover)]/40">
          <td colSpan={4} className="px-4 py-3">
            {detailQuery.isLoading ? (
              <p className="text-xs text-[var(--text-muted)]">Loading…</p>
            ) : detailQuery.isError ? (
              <p className="text-xs text-[var(--red)]">
                {getApiErrorMessage(
                  detailQuery.error,
                  "Unable to manage this membership here — try Admin → Role Assignments instead.",
                )}
              </p>
            ) : !assignment ? (
              <p className="text-xs text-[var(--text-muted)]">Could not find this exact assignment.</p>
            ) : !active ? (
              <p className="text-xs text-[var(--text-muted)]">This assignment has already ended.</p>
            ) : (
              <div className="flex items-center gap-4 text-xs">
                {isAppAdmin ? (
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate()}
                    disabled={removeMutation.isPending}
                    title="Application Admin access is always global and can't be time-bound — remove it to revoke immediately"
                    className="font-medium text-[var(--red)] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {removeMutation.isPending ? 'Removing…' : 'Remove'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => endMutation.mutate()}
                    disabled={endMutation.isPending}
                    title="Ends this assignment as of today"
                    className="font-medium text-[var(--red)] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {endMutation.isPending ? 'Ending…' : 'End membership'}
                  </button>
                )}
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const groupId = id ? asGroupId(id) : null;
  const { user, permissions } = useAuth();
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [isManagingDataAccess, setIsManagingDataAccess] = useState(false);

  const groupQuery = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => {
      if (!groupId) {
        throw new Error('Missing group id.');
      }
      return fetchGroup(groupId);
    },
    enabled: groupId !== null,
  });

  // Only needed to resolve a scoped (non-org-wide) member's effective permissions on this
  // group — see hasScopedPermission. Org role counts are small, so an unpaginated fetch is
  // the same tradeoff already made by AddMemberModal/AdminRolesSection.
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles });
  const roles = rolesQuery.data ?? [];

  const group = groupQuery.data;
  const members = group?.members ?? [];
  // Adding/ending/removing a membership is a role-assignment action (roles:assign), not
  // users:manage — matches user.routes.ts's POST/DELETE/PATCH .../role-assignments gates
  // exactly (see requireScopedPermission(roles:assign, ...) there).
  const canManageMembers =
    group && user ? hasScopedPermission(group, roles, user.id, permissions, 'roles:assign') : false;
  const canManageDataAccess =
    group && user ? hasScopedPermission(group, roles, user.id, permissions, 'groups:manageDataAccess') : false;

  if (!groupId) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12">
        <p className="text-sm text-[var(--red)]">Invalid group id.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{group?.name ?? 'Group'}</h1>
          {group?.description ? (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{group.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManageDataAccess ? (
            <button
              type="button"
              onClick={() => setIsManagingDataAccess(true)}
              className="flex items-center gap-1.5 rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              <Lock size={14} />
              Data access
            </button>
          ) : null}
          {canManageMembers ? (
            <button
              type="button"
              onClick={() => setIsAddingMember(true)}
              className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              Add member
            </button>
          ) : null}
        </div>
      </div>

      {groupQuery.isError ? (
        <p className="mt-6 text-sm text-[var(--red)]">
          {getApiErrorMessage(groupQuery.error, 'Unable to load group.')}
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
              <th className="pb-2 pr-4 font-medium">Email</th>
              <th className="pb-2 pr-4 font-medium">Role</th>
              <th className="pb-2 pr-4 font-medium">Active dates</th>
              {canManageMembers ? <th className="pb-2 font-medium">&nbsp;</th> : null}
            </tr>
          </thead>
          <tbody>
            {groupQuery.isLoading
              ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => <SkeletonRow key={index} />)
              : members.map((member) => (
                  <MemberRow
                    key={`${member.userId}-${member.roleId}`}
                    groupId={groupId}
                    member={member}
                    canManage={canManageMembers}
                  />
                ))}
          </tbody>
        </table>

        {!groupQuery.isLoading && members.length === 0 ? (
          <EmptyState icon={Users} title="No members yet" />
        ) : null}
      </div>

      {group ? (
        <p className="mt-6 text-xs text-[var(--text-muted)]">Created {formatDate(group.createdAt)}</p>
      ) : null}

      {isAddingMember && group ? (
        <AddMemberModal group={group} onClose={() => setIsAddingMember(false)} />
      ) : null}
      {isManagingDataAccess && group ? (
        <GroupDataAccessModal group={group} onClose={() => setIsManagingDataAccess(false)} />
      ) : null}
    </div>
  );
}
