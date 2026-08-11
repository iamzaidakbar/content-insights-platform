import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import { useAuth } from '../../auth/AuthContext';
import Button from '../ui/Button';
import { Input } from '../ui/Input';
import Modal from '../ui/Modal';
import { getApiErrorMessage } from '../../lib/api-client';
import { changePassword } from '../../lib/auth-api';
import { deleteMe, updateMe } from '../../lib/users-api';
import { INPUT_CLASSNAME } from '../../lib/form-styles';
import { SettingsRow, SettingsSection } from './SettingsSection';

// No client-side validation library is used elsewhere in this app (LoginPage/
// RegisterPage both hand-roll it) — matching that rather than adding zod as a new direct
// dependency of apps/web just for this one form.
function computePasswordStrength(password: string): number {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4);
}

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLORS = ['var(--red)', 'var(--red)', '#f59e0b', '#eab308', 'var(--green)'];

function PasswordStrengthBar({ password }: { password: string }) {
  if (!password) {
    return null;
  }
  const score = computePasswordStrength(password);
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((segment) => (
          <div
            key={segment}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ backgroundColor: segment < score ? STRENGTH_COLORS[score] : 'var(--border)' }}
          />
        ))}
      </div>
      <p className="mt-1 text-xs" style={{ color: STRENGTH_COLORS[score] }}>
        {STRENGTH_LABELS[score]}
      </p>
    </div>
  );
}

function DisplayNameField() {
  const { user, updateUser } = useAuth();
  const committedName = user?.displayName ?? '';
  const [value, setValue] = useState(committedName);
  // "Save" appears once there's a meaningful edit to persist — a superset of "appears on
  // focus" (focusing without typing shows nothing to save, which is the same net result)
  // that avoids a fragile focus/blur-vs-click-target race.
  const isDirty = value.trim().length > 0 && value.trim() !== committedName;

  const mutation = useMutation({
    mutationFn: updateMe,
    onSuccess: (updatedUser) => {
      updateUser({ displayName: updatedUser.displayName });
      toast.success('Display name updated.');
    },
  });

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--text-secondary)]">Display name</label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Add a display name"
          maxLength={100}
          className={`max-w-xs ${INPUT_CLASSNAME}`}
        />
        {isDirty ? (
          <button
            type="button"
            onClick={() => mutation.mutate(value.trim())}
            disabled={mutation.isPending}
            className="h-9 shrink-0 rounded-[var(--radius-button)] bg-[var(--accent)] px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate(): string | null {
    if (newPassword.length < 8) {
      return 'New password must be at least 8 characters.';
    }
    if (newPassword !== confirmPassword) {
      return 'New password and confirmation do not match.';
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await changePassword({ currentPassword, newPassword });
      toast.success('Password changed.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to change your password.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="max-w-sm space-y-3">
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)]">Current password</label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className={`mt-1 ${INPUT_CLASSNAME}`}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)]">New password</label>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className={`mt-1 ${INPUT_CLASSNAME}`}
        />
        <PasswordStrengthBar password={newPassword} />
      </div>
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)]">Confirm new password</label>
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className={`mt-1 ${INPUT_CLASSNAME}`}
        />
      </div>

      {error ? <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="h-9 rounded-[var(--radius-button)] bg-[var(--accent)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? 'Updating…' : 'Change password'}
      </button>
    </form>
  );
}

function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [confirmEmail, setConfirmEmail] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const canDelete = confirmEmail.length > 0 && confirmEmail.trim().toLowerCase() === (user?.email ?? '').toLowerCase();

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await deleteMe();
      await logout();
      toast.success('Your account has been deleted.');
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Unable to delete your account.'));
      setIsDeleting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete account"
      size="sm"
      className="border-2 border-[var(--red)]"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={!canDelete}
            loading={isDeleting}
          >
            Delete account
          </Button>
        </>
      }
    >
      <p className="text-sm text-[var(--text-secondary)]">
        This permanently deletes your account and cannot be undone. Type{' '}
        <strong className="text-[var(--text-primary)]">{user?.email}</strong> to confirm.
      </p>
      <Input
        type="text"
        autoFocus
        value={confirmEmail}
        onChange={(event) => setConfirmEmail(event.target.value)}
        placeholder={user?.email}
        className="mt-3"
      />
    </Modal>
  );
}

export default function AccountSection() {
  const { user, org, permissions } = useAuth();
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  return (
    <div className="space-y-6">
      <SettingsSection title="Profile">
        <DisplayNameField />
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)]">Email</label>
          <p
            className="mt-1 max-w-xs rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            {user?.email ?? '—'}
          </p>
        </div>
      </SettingsSection>

      {/* Read-only account/access facts — absorbed from what used to be a separate
          "General" overview tab (email/org/permissions) now that General is dedicated to
          actual editable preferences (theme/date format/language). Account is the more
          natural home for "facts about you and your access." */}
      <SettingsSection title="Access">
        <SettingsRow label="Organization">
          <span className="text-sm text-[var(--text-primary)]">{org?.name ?? '—'}</span>
        </SettingsRow>
        <SettingsRow label="Permissions">
          <div className="flex max-w-xs flex-wrap justify-end gap-1.5">
            {permissions.map((permission) => (
              <span
                key={permission}
                className="rounded-[var(--radius-tag)] px-2 py-0.5 text-xs"
                style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
              >
                {permission}
              </span>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Change password">
        <ChangePasswordForm />
      </SettingsSection>

      <section
        className="rounded-[var(--radius-card)] border-2 p-6"
        style={{ borderColor: 'var(--red)', backgroundColor: 'var(--bg-card)' }}
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--red)' }}>
          Danger zone
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Permanently delete your account and all associated data. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => setIsDeleteModalOpen(true)}
          className="mt-4 h-9 rounded-[var(--radius-button)] border px-4 text-sm font-medium transition-colors"
          style={{ borderColor: 'var(--red)', color: 'var(--red)' }}
        >
          Delete account
        </button>
      </section>

      {isDeleteModalOpen ? <DeleteAccountModal onClose={() => setIsDeleteModalOpen(false)} /> : null}
    </div>
  );
}
