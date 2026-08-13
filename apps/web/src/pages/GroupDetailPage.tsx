import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarOff, Lock, Settings2, UserMinus, Users } from 'lucide-react';

import { asGroupId, type GroupMemberSummary } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import AddMemberModal from '../components/AddMemberModal';
import EmptyState from '../components/EmptyState';
import GroupDataAccessModal from '../components/GroupDataAccessModal';
import Alert from '../components/ui/alert';
import { ActionIconButton } from '../components/ui/action-icon-button';
import Breadcrumbs from '../components/ui/Breadcrumbs';
import Button from '../components/ui/button';
import PageHeader, { PageBody } from '../components/ui/PageHeader';
import Skeleton from '../components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/data-table';
import { getApiErrorMessage } from '../lib/api-client';
import { formatDate } from '../lib/format';
import { fetchGroup } from '../lib/groups-api';
import { fetchRoles } from '../lib/roles-api';
import { APPLICATION_ADMIN_ROLE_NAME, hasScopedPermission, isRoleAssignmentActive } from '../lib/scoped-permissions';
import { fetchOrgUsers, revokeUserRoleAssignment, updateRoleAssignmentEndDate } from '../lib/users-api';

const SKELETON_ROW_COUNT = 3;

function SkeletonRow({ showActions }: { showActions: boolean }) {
  return (
    <TR>
      <TD>
        <Skeleton className="h-4 w-40" />
      </TD>
      <TD>
        <Skeleton className="h-4 w-20" />
      </TD>
      <TD>
        <Skeleton className="h-4 w-16" />
      </TD>
      {showActions ? (
        <TD>
          <Skeleton className="h-4 w-16" />
        </TD>
      ) : null}
    </TR>
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
      <TR>
        <TD>{member.userEmail}</TD>
        <TD className="text-muted-foreground">{member.roleName}</TD>
        <TD className="text-xs text-muted-foreground">
          {member.startDate ? formatDate(member.startDate) : 'Open'} –{' '}
          {member.endDate ? formatDate(member.endDate) : 'Open'}
          {!active ? <span className="ml-1.5 text-muted-foreground">(ended)</span> : null}
        </TD>
        {canManage ? (
          <TD>
            <ActionIconButton
              label={isManaging ? 'Hide membership actions' : 'Manage membership'}
              icon={Settings2}
              onClick={() => setIsManaging((current) => !current)}
            />
          </TD>
        ) : null}
      </TR>
      {canManage && isManaging ? (
        <TR className="bg-accent/40 hover:bg-accent/40">
          <TD colSpan={4} className="px-3 py-3">
            {detailQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : detailQuery.isError ? (
              <p className="text-xs text-destructive">
                {getApiErrorMessage(
                  detailQuery.error,
                  "Unable to manage this membership here — try Admin → Role Assignments instead.",
                )}
              </p>
            ) : !assignment ? (
              <p className="text-xs text-muted-foreground">Could not find this exact assignment.</p>
            ) : !active ? (
              <p className="text-xs text-muted-foreground">This assignment has already ended.</p>
            ) : (
              <div className="flex items-center gap-1">
                {isAppAdmin ? (
                  <ActionIconButton
                    label={removeMutation.isPending ? 'Removing…' : 'Remove'}
                    icon={UserMinus}
                    onClick={() => removeMutation.mutate()}
                    disabled={removeMutation.isPending}
                    destructive
                  />
                ) : (
                  <ActionIconButton
                    label={endMutation.isPending ? 'Ending…' : 'End membership'}
                    icon={CalendarOff}
                    onClick={() => endMutation.mutate()}
                    disabled={endMutation.isPending}
                    destructive
                  />
                )}
              </div>
            )}
          </TD>
        </TR>
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
      <PageBody>
        <Alert variant="error">Invalid group id.</Alert>
      </PageBody>
    );
  }

  const groupTitle = group?.name ?? 'Group';

  return (
    <PageBody>
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'Groups', to: '/groups' }, { label: groupTitle }]} />}
        title={groupTitle}
        {...(group?.description ? { description: group.description } : {})}
        actions={
          <>
            {canManageDataAccess ? (
              <Button variant="outline" size="sm" leftIcon={<Lock size={14} />} onClick={() => setIsManagingDataAccess(true)}>
                Data access
              </Button>
            ) : null}
            {canManageMembers ? (
              <Button size="sm" onClick={() => setIsAddingMember(true)}>
                Add member
              </Button>
            ) : null}
          </>
        }
      />

      {groupQuery.isError ? (
        <Alert variant="error" className="mb-4">
          {getApiErrorMessage(groupQuery.error, 'Unable to load group.')}
        </Alert>
      ) : null}

      {!groupQuery.isLoading && members.length === 0 ? (
        <EmptyState icon={Users} title="No members yet" />
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Active dates</TH>
              {canManageMembers ? <TH>&nbsp;</TH> : null}
            </TR>
          </THead>
          <TBody>
            {groupQuery.isLoading
              ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                  <SkeletonRow key={index} showActions={canManageMembers} />
                ))
              : members.map((member) => (
                  <MemberRow
                    key={`${member.userId}-${member.roleId}`}
                    groupId={groupId}
                    member={member}
                    canManage={canManageMembers}
                  />
                ))}
          </TBody>
        </Table>
      )}

      {group ? (
        <p className="mt-4 text-xs text-muted-foreground">Created {formatDate(group.createdAt)}</p>
      ) : null}

      {isAddingMember && group ? (
        <AddMemberModal group={group} onClose={() => setIsAddingMember(false)} />
      ) : null}
      {isManagingDataAccess && group ? (
        <GroupDataAccessModal group={group} onClose={() => setIsManagingDataAccess(false)} />
      ) : null}
    </PageBody>
  );
}
