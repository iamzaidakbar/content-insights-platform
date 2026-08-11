import { useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import AccountSection from '../components/settings/AccountSection';
import FilterLayoutSection from '../components/settings/FilterLayoutSection';
import GeneralSection from '../components/settings/GeneralSection';
import GlobalSettingsSection from '../components/settings/GlobalSettingsSection';
import SearchPreferencesSection from '../components/settings/SearchPreferencesSection';
import { PageBody, PageHeader } from '../components/ui';

type SectionKey = 'general' | 'search' | 'account' | 'global' | 'filter-layout';

interface SectionDef {
  key: SectionKey;
  label: string;
  // Absent = visible to every authenticated user (General/Search/Account). Present = only
  // shown to holders of this permission (Application Admin's '*' always qualifies too) —
  // Global Settings and Filter Layout are both gated on global-settings:manage.
  permission?: string;
}

const SECTIONS: SectionDef[] = [
  { key: 'general', label: 'General' },
  { key: 'search', label: 'Search Preferences' },
  { key: 'account', label: 'Account' },
  { key: 'global', label: 'Global Settings', permission: 'global-settings:manage' },
  { key: 'filter-layout', label: 'Filter Layout', permission: 'global-settings:manage' },
];

// Organization management (name/slug/plan/members) lives under /admin, not here — it's
// already mounted there (see AdminPage.tsx), gated by the org:admin route guard, so it
// isn't duplicated in this per-user/per-org-config settings screen.
export default function SettingsPage() {
  const { permissions } = useAuth();
  const canSee = (section: SectionDef) =>
    !section.permission || permissions.includes('*') || permissions.includes(section.permission);
  const visibleSections = SECTIONS.filter(canSee);

  const [activeSection, setActiveSection] = useState<SectionKey>('general');
  // Falls back to the first visible tab if the active one is (or becomes, e.g. after a
  // permission-changing role update) hidden — never renders a nav with no highlighted item.
  const resolvedSection = visibleSections.some((section) => section.key === activeSection)
    ? activeSection
    : (visibleSections[0]?.key ?? 'general');

  return (
    <PageBody width="lg">
      <PageHeader title="Settings" description="Manage your preferences and organization configuration." />

      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        <nav className="w-full shrink-0 sm:w-[200px]">
          <div className="space-y-1">
            {visibleSections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                className={`block w-full rounded-[var(--radius-button)] px-3 py-2 text-left text-sm transition-colors ${
                  resolvedSection === section.key
                    ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                {section.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Every section stays mounted (visibility toggled via `hidden`, not conditional
            rendering) so switching tabs never destroys another section's unsaved local
            draft — each section's dirty state is independent of which one is currently
            visible, not just independent of the others' values. */}
        <div className="min-w-0 flex-1 pb-16">
          <div className={resolvedSection === 'general' ? '' : 'hidden'}>
            <GeneralSection />
          </div>
          <div className={resolvedSection === 'search' ? '' : 'hidden'}>
            <SearchPreferencesSection />
          </div>
          <div className={resolvedSection === 'account' ? '' : 'hidden'}>
            <AccountSection />
          </div>
          {/* Not further gated here on purpose: the nav above already hides these tabs from
              anyone lacking global-settings:manage, and both components re-check the
              permission themselves (rendering an "Admins only" EmptyState) as a defensive
              second layer rather than trusting nav visibility alone. */}
          <div className={resolvedSection === 'global' ? '' : 'hidden'}>
            <GlobalSettingsSection />
          </div>
          <div className={resolvedSection === 'filter-layout' ? '' : 'hidden'}>
            <FilterLayoutSection />
          </div>
        </div>
      </div>
    </PageBody>
  );
}
