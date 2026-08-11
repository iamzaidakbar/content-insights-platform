import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, Copy, UserPlus, Users } from 'lucide-react';

import type { User } from '@content-insights/shared';

import { useAuth } from '../../auth/AuthContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { getApiErrorMessage } from '../../lib/api-client';
import { formatDate } from '../../lib/format';
import { INPUT_CLASSNAME } from '../../lib/form-styles';
import {
  createUser,
  deactivateUser,
  deleteUser,
  fetchOrgUsers,
  type CreateUserInput,
} from '../../lib/users-api';
import EmptyState from '../EmptyState';
import Pagination from '../Pagination';
import { SettingsSection } from '../settings/SettingsSection';

const DEBOUNCE_MS = 300;
const SKELETON_ROW_COUNT = 5;

// ---------------------------------------------------------------------------------------
// Create user — POST /api/users (users:manage) has no outbound email/SMTP integration, so
// the server-generated temporary password is returned exactly once in the create response.
// Splitting this into two dialogs (form, then a dedicated copyable password reveal) means
// that one-time value can't be lost by a stray re-render/close of the form itself.
// ---------------------------------------------------------------------------------------

function TemporaryPasswordDialog({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      toast.success('Copied to clipboard.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Unable to copy.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Account created</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          A temporary password was generated for <span className="text-[var(--text-primary)]">{email}</span>. It is
          shown only this once — copy it now and share it with them out of band. It cannot be retrieved again.
        </p>

        <div className="mt-4 flex items-center gap-2">
          <code className="flex-1 truncate rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]">
            {password}
          </code>
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy temporary password"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            {copied ? <Check size={16} className="text-[var(--green)]" /> : <Copy size={16} />}
          </button>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (email: string, temporaryPassword: string) => void;
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
      onCreated(result.user.email, result.temporaryPassword);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">New user</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          A temporary password is generated automatically — there is no email delivery, so you will need to share
          it with them yourself.
        </p>
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="new-user-email" className="block text-sm font-medium text-[var(--text-secondary)]">
              Email
            </label>
            <input
              id="new-user-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={`mt-1 ${INPUT_CLASSNAME}`}
            />
          </div>

          <div>
            <label htmlFor="new-user-name" className="block text-sm font-medium text-[var(--text-secondary)]">
              Display name <span className="text-[var(--text-muted)]">(optional)</span>
            </label>
            <input
              id="new-user-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
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
              {createMutation.isPending ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Delete user?</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          <span className="text-[var(--text-primary)]">{target.email}</span> will be permanently removed, along
          with every role assignment they hold. This cannot be undone.
        </p>
        {error ? <p className="mt-3 text-sm text-[var(--red)]">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="rounded-[var(--radius-button)] bg-[var(--red)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete user'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusToggle({ target, disabledReason }: { target: User; disabledReason?: string }) {
  const queryClient = useQueryClient();

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateUser(target.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org-users'] });
      toast.success(`${target.email} deactivated.`);
    },
  });

  // The API only exposes PATCH /:id/deactivate (one-directional) — there is currently no
  // reactivation endpoint, so an already-inactive user's control stays disabled rather than
  // silently doing nothing or 404ing on click.
  const title =
    disabledReason ??
    (target.isActive
      ? 'Deactivate this account'
      : 'Reactivation is not currently supported — create a new account if needed');
  const disabled = Boolean(disabledReason) || !target.isActive || deactivateMutation.isPending;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={target.isActive}
      title={title}
      disabled={disabled}
      onClick={() => target.isActive && deactivateMutation.mutate()}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
        target.isActive ? 'bg-[var(--green)]' : 'bg-[var(--border)]'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          target.isActive ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

export default function AdminUsersSection() {
  const { user: currentUser, permissions } = useAuth();
  const [page, setPage] = useState(1);
  const [rawQuery, setRawQuery] = useState('');
  const debouncedQuery = useDebouncedValue(rawQuery, DEBOUNCE_MS);
  const [isCreating, setIsCreating] = useState(false);
  const [passwordReveal, setPasswordReveal] = useState<{ email: string; password: string } | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const canManage = permissions.includes('users:manage') || permissions.includes('*');
  const canDelete = permissions.includes('users:delete') || permissions.includes('*');

  const usersQuery = useQuery({
    queryKey: ['org-users', page, debouncedQuery],
    queryFn: () => fetchOrgUsers(page, debouncedQuery.trim() || undefined),
  });

  const users = usersQuery.data?.items ?? [];
  const showEmptyState = !usersQuery.isLoading && !usersQuery.isError && users.length === 0;

  return (
    <SettingsSection
      title="Users"
      description="Every account in your organization. Role assignments are managed from Role Assignments."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        {canManage ? (
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-1.5 rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            <UserPlus size={15} />
            New user
          </button>
        ) : null}
      </div>

      {usersQuery.isError ? (
        <p className="text-sm text-[var(--red)]">{getApiErrorMessage(usersQuery.error, 'Unable to load users.')}</p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
              <th className="pb-2 pr-4 font-medium">Email</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
              <th className="pb-2 pr-4 font-medium">Created</th>
              {canDelete ? <th className="pb-2 font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {usersQuery.isLoading
              ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                  <tr key={index} className="h-12 border-b border-[var(--border)]">
                    <td className="py-3 pr-4">
                      <div className="h-4 w-48 animate-pulse rounded bg-[var(--bg-hover)]" />
                    </td>
                    <td className="py-3 pr-4">
                      <div className="h-4 w-10 animate-pulse rounded bg-[var(--bg-hover)]" />
                    </td>
                    <td className="py-3 pr-4">
                      <div className="h-4 w-24 animate-pulse rounded bg-[var(--bg-hover)]" />
                    </td>
                    {canDelete ? (
                      <td className="py-3">
                        <div className="h-4 w-20 animate-pulse rounded bg-[var(--bg-hover)]" />
                      </td>
                    ) : null}
                  </tr>
                ))
              : users.map((orgUser) => {
                  const isSelf = currentUser?.id === orgUser.id;
                  return (
                    <tr key={orgUser.id} className="h-12 border-b border-[var(--border)]">
                      <td className="py-3 pr-4">
                        <p className="text-[var(--text-primary)]">{orgUser.email}</p>
                        {orgUser.displayName ? (
                          <p className="text-xs text-[var(--text-muted)]">{orgUser.displayName}</p>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <StatusToggle
                            target={orgUser}
                            {...(isSelf ? { disabledReason: "You can't deactivate your own account" } : {})}
                          />
                          <span
                            className={orgUser.isActive ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}
                          >
                            {orgUser.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-secondary)]">{formatDate(orgUser.createdAt)}</td>
                      {canDelete ? (
                        <td className="py-3">
                          <button
                            type="button"
                            onClick={() => setDeleting(orgUser)}
                            disabled={isSelf}
                            title={isSelf ? "You can't delete your own account" : 'Delete this user'}
                            className="text-xs text-[var(--red)] hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                          >
                            Delete
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
          </tbody>
        </table>

        {showEmptyState ? (
          <EmptyState
            icon={Users}
            title="No users found"
            description={debouncedQuery ? 'Try a different search.' : undefined}
          />
        ) : null}
      </div>

      {usersQuery.data && usersQuery.data.totalPages > 1 ? (
        <div className="flex justify-end">
          <Pagination page={page} totalPages={usersQuery.data.totalPages} onPageChange={setPage} />
        </div>
      ) : null}

      {isCreating ? (
        <CreateUserModal
          onClose={() => setIsCreating(false)}
          onCreated={(email, password) => {
            setIsCreating(false);
            setPasswordReveal({ email, password });
          }}
        />
      ) : null}
      {passwordReveal ? (
        <TemporaryPasswordDialog
          email={passwordReveal.email}
          password={passwordReveal.password}
          onClose={() => setPasswordReveal(null)}
        />
      ) : null}
      {deleting ? <DeleteUserDialog target={deleting} onClose={() => setDeleting(null)} /> : null}
    </SettingsSection>
  );
}
