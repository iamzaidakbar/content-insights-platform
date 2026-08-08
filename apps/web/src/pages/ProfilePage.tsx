import { useAuth } from '../auth/AuthContext';

export default function ProfilePage() {
  const { user, org, permissions } = useAuth();

  return (
    <div className="mx-auto w-full max-w-xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">User</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">Your account details.</p>

      <div className="mt-6 space-y-4">
        <div>
          <span className="block text-sm font-medium text-[var(--text-secondary)]">Email</span>
          <p className="mt-1 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]">
            {user?.email ?? '—'}
          </p>
        </div>

        <div>
          <span className="block text-sm font-medium text-[var(--text-secondary)]">
            Organization
          </span>
          <p className="mt-1 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]">
            {org?.name ?? '—'}
          </p>
        </div>

        <div>
          <span className="block text-sm font-medium text-[var(--text-secondary)]">
            Permissions
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
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
        </div>
      </div>
    </div>
  );
}
