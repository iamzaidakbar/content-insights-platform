import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useAuth } from '../../auth/AuthContext';
import Button from '../ui/button';
import { Input } from '../ui/input';
import Modal from '../ui/Modal';
import { getApiErrorMessage } from '../../lib/api-client';
import { changePassword } from '../../lib/auth-api';
import { deleteMe, updateMe } from '../../lib/users-api';
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
const STRENGTH_COLORS = ['var(--destructive)', 'var(--destructive)', '#f59e0b', '#eab308', 'var(--success)'];

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
      <label className="block text-sm font-medium text-muted-foreground">Display name</label>
      <div className="mt-1 flex items-center gap-2">
        <Input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Add a display name"
          maxLength={100}
          className="max-w-xs"
        />
        {isDirty ? (
          <Button type="button" onClick={() => mutation.mutate(value.trim())} loading={mutation.isPending}>
            Save
          </Button>
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
        <label className="block text-xs font-medium text-muted-foreground">Current password</label>
        <Input
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          className="mt-1"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground">New password</label>
        <Input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          className="mt-1"
        />
        <PasswordStrengthBar password={newPassword} />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted-foreground">Confirm new password</label>
        <Input
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="mt-1"
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="submit" loading={isSubmitting}>
        Change password
      </Button>
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
      className="border-2 border-destructive"
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
      <p className="text-sm text-muted-foreground">
        This permanently deletes your account and cannot be undone. Type{' '}
        <strong className="text-foreground">{user?.email}</strong> to confirm.
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
    <div className="space-y-4">
      <SettingsSection title="Profile">
        <DisplayNameField />
        <div>
          <label className="block text-sm font-medium text-muted-foreground">Email</label>
          <p className="mt-1 max-w-xs rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
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
          <span className="text-sm text-foreground">{org?.name ?? '—'}</span>
        </SettingsRow>
        <SettingsRow label="Permissions">
          <div className="flex max-w-xs flex-wrap justify-end gap-1.5">
            {permissions.map((permission) => (
              <span key={permission} className="rounded-sm bg-muted px-2 py-0.5 text-xs text-foreground">
                {permission}
              </span>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Change password">
        <ChangePasswordForm />
      </SettingsSection>

      <section className="rounded-lg border-2 border-destructive bg-card p-4">
        <h2 className="text-base font-semibold text-destructive">Danger zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanently delete your account and all associated data. This cannot be undone.
        </p>
        <Button type="button" variant="destructive" className="mt-3" onClick={() => setIsDeleteModalOpen(true)}>
          Delete account
        </Button>
      </section>

      {isDeleteModalOpen ? <DeleteAccountModal onClose={() => setIsDeleteModalOpen(false)} /> : null}
    </div>
  );
}
