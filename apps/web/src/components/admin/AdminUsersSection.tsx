import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, KeyRound, Mail, Trash2, UserPlus, Users } from 'lucide-react';

import type { User } from '@content-insights/shared';

import { useAuth } from '../../auth/AuthContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { getApiErrorMessage } from '../../lib/api-client';
import { formatDate } from '../../lib/format';
import {
  createUser,
  deleteUser,
  fetchOrgUsers,
  inviteUser,
  resetUserPassword,
  setUserActive,
  type CreateUserInput,
} from '../../lib/users-api';
import { fetchRoles } from '../../lib/roles-api';
import EmptyState from '../EmptyState';
import Pagination from '../Pagination';
import Alert from '../ui/alert';
import { ActionIconButton } from '../ui/action-icon-button';
import Button from '../ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '../ui/card';
import ConfirmDialog from '../ui/ConfirmDialog';
import { Input } from '../ui/input';
import Modal from '../ui/Modal';
import Skeleton from '../ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '../ui/data-table';

const DEBOUNCE_MS = 300;
const SKELETON_ROW_COUNT = 5;

// ---------------------------------------------------------------------------------------
// Create user — POST /api/users (users:manage) has no outbound email/SMTP integration, so
// a one-time invite URL is returned exactly once in the create response.
// Splitting this into two dialogs (form, then a dedicated copyable password reveal) means
// that one-time value can't be lost by a stray re-render/close of the form itself.
// ---------------------------------------------------------------------------------------

function CopyLinkDialog({
  title,
  description,
  url,
  onClose,
}: {
  title: string;
  description: string;
  url: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Copied to clipboard.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Unable to copy.');
    }
  }

  return (
    <Modal open onClose={onClose} title={title} size="sm">
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 flex items-center gap-2">
        <code className="flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
          {url}
        </code>
        <Button
          variant="outline"
          size="sm"
          aria-label="Copy link"
          onClick={() => void handleCopy()}
          className="h-9 w-9 shrink-0 px-0"
        >
          {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
        </Button>
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (email: string, inviteUrl: string) => void;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => {
      const input: CreateUserInput = { email: email.trim() };
      if (displayName.trim()) {
        input.displayName = displayName.trim();
      }
      return createUser(input);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['org-users'] });
      onCreated(result.user.email, result.inviteUrl);
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to create user.')),
    meta: { skipToast: true },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    createMutation.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New user"
      description="A temporary password is generated automatically — there is no email delivery, so you will need to share it with them yourself."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-user-form" loading={createMutation.isPending}>
            Create user
          </Button>
        </>
      }
    >
      <form id="create-user-form" className="space-y-3" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="new-user-email" className="block text-sm font-medium text-muted-foreground">
            Email
          </label>
          <Input
            id="new-user-email"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1"
          />
        </div>

        <div>
          <label htmlFor="new-user-name" className="block text-sm font-medium text-muted-foreground">
            Display name <span className="text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="new-user-name"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="mt-1"
          />
        </div>

        {error ? <Alert variant="error">{error}</Alert> : null}
      </form>
    </Modal>
  );
}

function DeleteUserDialog({ target, onClose }: { target: User; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: () => deleteUser(target.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-users'] });
      toast.success('User deleted.');
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to delete this user.')),
    meta: { skipToast: true },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete user?"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
            Delete user
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        <span className="text-foreground">{target.email}</span> will be permanently removed, along with
        every role assignment they hold. This cannot be undone.
      </p>
      {error ? (
        <Alert variant="error" className="mt-3">
          {error}
        </Alert>
      ) : null}
    </Modal>
  );
}

function StatusToggle({ target, disabledReason }: { target: User; disabledReason?: string }) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState('');

  const nextActive = !target.isActive;

  const statusMutation = useMutation({
    mutationFn: (isActive: boolean) => setUserActive(target.id, isActive, reason.trim() || undefined),
    onSuccess: (_user, isActive) => {
      void queryClient.invalidateQueries({ queryKey: ['org-users'] });
      toast.success(isActive ? `${target.email} activated.` : `${target.email} deactivated.`);
      setConfirmOpen(false);
      setReason('');
    },
    onError: (err: unknown) => {
      toast.error(getApiErrorMessage(err, 'Unable to change account status.'));
    },
  });

  const title =
    disabledReason ?? (target.isActive ? 'Deactivate this account' : 'Activate this account');
  const disabled = Boolean(disabledReason) || statusMutation.isPending;

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={target.isActive}
        title={title}
        disabled={disabled}
        onClick={() => setConfirmOpen(true)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
          target.isActive ? 'bg-success' : 'bg-border'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            target.isActive ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => {
          if (!statusMutation.isPending) {
            setConfirmOpen(false);
            setReason('');
          }
        }}
        onConfirm={() => statusMutation.mutate(nextActive)}
        title={nextActive ? `Activate ${target.email}?` : `Deactivate ${target.email}?`}
        description={
          nextActive
            ? 'They will be able to sign in again.'
            : 'They will be signed out on every device and cannot sign in until reactivated.'
        }
        confirmLabel={nextActive ? 'Activate' : 'Deactivate'}
        destructive={!nextActive}
        loading={statusMutation.isPending}
      >
        <label className="block text-xs font-medium text-muted-foreground">
          Reason (optional)
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={2}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
      </ConfirmDialog>
    </>
  );
}

export default function AdminUsersSection() {
  const { user: currentUser, permissions } = useAuth();
  const [page, setPage] = useState(1);
  const [rawQuery, setRawQuery] = useState('');
  const debouncedQuery = useDebouncedValue(rawQuery, DEBOUNCE_MS);
  const [isCreating, setIsCreating] = useState(false);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [linkReveal, setLinkReveal] = useState<{ title: string; description: string; url: string } | null>(
    null,
  );
  const [roleId, setRoleId] = useState('');
  const [sort, setSort] = useState<'email' | 'createdAt' | 'lastLoginAt'>('email');

  const canManage = permissions.includes('users:manage') || permissions.includes('*');
  const canDelete = permissions.includes('users:delete') || permissions.includes('*');

  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: fetchRoles, staleTime: 60_000 });

  const usersQuery = useQuery({
    queryKey: ['org-users', page, debouncedQuery, roleId, sort],
    queryFn: () =>
      fetchOrgUsers(page, {
        ...(debouncedQuery.trim() ? { email: debouncedQuery.trim() } : {}),
        ...(roleId ? { roleId } : {}),
        sort,
        order: sort === 'email' ? 'asc' : 'desc',
      }),
  });

  const users = usersQuery.data?.items ?? [];
  const showEmptyState = !usersQuery.isLoading && !usersQuery.isError && users.length === 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Card className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden py-4">
      <CardHeader className="shrink-0 px-4">
        <CardTitle className="text-base">Users</CardTitle>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Every account in your organization. Role assignments are managed from Role Assignments.
          Only an Application Admin can activate or deactivate accounts.
        </p>
      </CardHeader>
      <CardBody className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
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
          <select
            value={roleId}
            onChange={(event) => {
              setRoleId(event.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-border bg-card px-2 text-sm"
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            {(rolesQuery.data ?? []).map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            className="h-9 rounded-md border border-border bg-card px-2 text-sm"
            aria-label="Sort users"
          >
            <option value="email">Sort: email</option>
            <option value="createdAt">Sort: created</option>
            <option value="lastLoginAt">Sort: last login</option>
          </select>
          {canManage ? (
            <Button size="sm" leftIcon={<UserPlus size={15} />} onClick={() => setIsCreating(true)}>
              New user
            </Button>
          ) : null}
        </div>

        {usersQuery.isError ? (
          <Alert variant="error" className="shrink-0">
            {getApiErrorMessage(usersQuery.error, 'Unable to load users.')}
          </Alert>
        ) : null}

        <Table scrollable>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Email</TH>
              <TH>Status</TH>
              <TH>Provisioning</TH>
              <TH>Roles</TH>
              <TH>Last login</TH>
              <TH>Created</TH>
              {canManage || canDelete ? <TH>Actions</TH> : null}
            </TR>
          </THead>
          <TBody>
            {usersQuery.isLoading
              ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                  <TR key={index}>
                    <TD>
                      <Skeleton className="h-4 w-48" />
                    </TD>
                    <TD>
                      <Skeleton className="h-4 w-10" />
                    </TD>
                    <TD>
                      <Skeleton className="h-4 w-24" />
                    </TD>
                    {canDelete ? (
                      <TD>
                        <Skeleton className="h-4 w-20" />
                      </TD>
                    ) : null}
                  </TR>
                ))
              : users.map((orgUser) => {
                  const isSelf = currentUser?.id === orgUser.id;
                  return (
                    <TR key={orgUser.id}>
                      <TD>
                        <p className="text-foreground">{orgUser.email}</p>
                        {orgUser.displayName ? (
                          <p className="text-xs text-muted-foreground">{orgUser.displayName}</p>
                        ) : null}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <StatusToggle
                            target={orgUser}
                            {...(isSelf
                              ? { disabledReason: "You can't deactivate your own account" }
                              : !canDelete
                                ? { disabledReason: 'You need permission to change account status' }
                                : {})}
                          />
                          <span
                            className={orgUser.isActive ? 'text-muted-foreground' : 'text-muted-foreground'}
                          >
                            {orgUser.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </TD>
                      <TD className="text-muted-foreground">
                        {orgUser.provisioning === 'invite_pending'
                          ? 'Invited'
                          : orgUser.provisioning === 'sso'
                            ? 'SSO'
                            : 'Local'}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap gap-1">
                          {orgUser.roleAssignments.slice(0, 3).map((assignment) => (
                            <span
                              key={assignment.id}
                              className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {assignment.roleName}
                            </span>
                          ))}
                        </div>
                      </TD>
                      <TD className="text-muted-foreground">
                        {orgUser.lastLoginAt ? formatDate(orgUser.lastLoginAt) : 'Never'}
                      </TD>
                      <TD className="text-muted-foreground">{formatDate(orgUser.createdAt)}</TD>
                      {canManage || canDelete ? (
                        <TD>
                          <div className="flex items-center gap-0.5">
                            {canManage ? (
                              <>
                                <ActionIconButton
                                  label="Invite"
                                  icon={Mail}
                                  onClick={() => {
                                    void inviteUser(orgUser.id).then((result) =>
                                      setLinkReveal({
                                        title: 'Invite link',
                                        description: `Share this link with ${orgUser.email}. It expires in 7 days.`,
                                        url: result.inviteUrl,
                                      }),
                                    );
                                  }}
                                />
                                <ActionIconButton
                                  label="Reset password"
                                  icon={KeyRound}
                                  onClick={() => {
                                    void resetUserPassword(orgUser.id).then((result) =>
                                      setLinkReveal({
                                        title: 'Password reset link',
                                        description: `Share this link with ${orgUser.email}. It expires in 24 hours.`,
                                        url: result.resetUrl,
                                      }),
                                    );
                                  }}
                                />
                              </>
                            ) : null}
                            {canDelete ? (
                              <ActionIconButton
                                label={isSelf ? "You can't delete your own account" : 'Delete user'}
                                icon={Trash2}
                                onClick={() => setDeleting(orgUser)}
                                disabled={isSelf}
                                destructive
                              />
                            ) : null}
                          </div>
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
          </TBody>
        </Table>

        {showEmptyState ? (
          <div className="shrink-0">
            <EmptyState
              icon={Users}
              title="No users found"
              description={debouncedQuery ? 'Try a different search.' : undefined}
            />
          </div>
        ) : null}

        {usersQuery.data && usersQuery.data.totalPages > 1 ? (
          <div className="flex shrink-0 justify-end">
            <Pagination page={page} totalPages={usersQuery.data.totalPages} onPageChange={setPage} />
          </div>
        ) : null}

        {isCreating ? (
          <CreateUserModal
            onClose={() => setIsCreating(false)}
            onCreated={(email, inviteUrl) => {
              setIsCreating(false);
              setLinkReveal({
                title: 'Account created',
                description: `Copy this invite link for ${email}. It is shown only this once and expires in 7 days.`,
                url: inviteUrl,
              });
            }}
          />
        ) : null}
        {linkReveal ? (
          <CopyLinkDialog
            title={linkReveal.title}
            description={linkReveal.description}
            url={linkReveal.url}
            onClose={() => setLinkReveal(null)}
          />
        ) : null}
        {deleting ? <DeleteUserDialog target={deleting} onClose={() => setDeleting(null)} /> : null}
      </CardBody>
    </Card>
    </section>
  );
}
