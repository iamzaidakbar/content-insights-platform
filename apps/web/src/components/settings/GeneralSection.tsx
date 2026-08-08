import { useAuth } from '../../auth/AuthContext';
import { SettingsRow, SettingsSection } from './SettingsSection';

// The spec's sub-nav lists "General" alongside Appearance/Notifications/Search
// Preferences/Account/Organization but never describes what belongs in it. Rather than
// inventing editable settings that don't map to any real field, this is a read-only
// landing overview — the same account/org/permission facts ProfilePage already shows,
// framed as the Settings section's front page.
export default function GeneralSection() {
  const { user, org, permissions } = useAuth();

  return (
    <div className="space-y-6">
      <SettingsSection title="Overview" description="A quick summary of your account and organization.">
        <SettingsRow label="Email">
          <span className="text-sm text-[var(--text-primary)]">{user?.email ?? '—'}</span>
        </SettingsRow>
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

      <p className="mt-4 text-sm text-[var(--text-secondary)]">
        Use the sections on the left to manage appearance, search defaults, notifications, and your account.
      </p>
    </div>
  );
}
