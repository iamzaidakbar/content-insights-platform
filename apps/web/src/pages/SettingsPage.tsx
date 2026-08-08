import { useState } from 'react';

import { useAuth } from '../auth/AuthContext';
import AccountSection from '../components/settings/AccountSection';
import AppearanceSection from '../components/settings/AppearanceSection';
import GeneralSection from '../components/settings/GeneralSection';
import NotificationsSection from '../components/settings/NotificationsSection';
import OrganizationSection from '../components/settings/OrganizationSection';
import SearchPreferencesSection from '../components/settings/SearchPreferencesSection';

type SectionKey = 'general' | 'appearance' | 'notifications' | 'search' | 'account' | 'organization';

interface SectionDef {
  key: SectionKey;
  label: string;
  adminOnly?: boolean;
}

const SECTIONS: SectionDef[] = [
  { key: 'general', label: 'General' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'search', label: 'Search Preferences' },
  { key: 'account', label: 'Account' },
  { key: 'organization', label: 'Organization', adminOnly: true },
];

export default function SettingsPage() {
  const { permissions } = useAuth();
  const isOrgAdmin = permissions.includes('org:admin') || permissions.includes('*');
  const [activeSection, setActiveSection] = useState<SectionKey>('general');

  const visibleSections = SECTIONS.filter((section) => !section.adminOnly || isOrgAdmin);

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-8 px-6 py-10">
      <nav className="w-[200px] shrink-0">
        <h1 className="mb-4 px-3 text-2xl font-semibold text-[var(--text-primary)]">Settings</h1>
        <div className="space-y-1">
          {visibleSections.map((section) => (
            <button
              key={section.key}
              type="button"
              onClick={() => setActiveSection(section.key)}
              className={`block w-full rounded-[var(--radius-button)] px-3 py-2 text-left text-sm transition-colors ${
                activeSection === section.key
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
        <div className={activeSection === 'general' ? '' : 'hidden'}>
          <GeneralSection />
        </div>
        <div className={activeSection === 'appearance' ? '' : 'hidden'}>
          <AppearanceSection />
        </div>
        <div className={activeSection === 'notifications' ? '' : 'hidden'}>
          <NotificationsSection />
        </div>
        <div className={activeSection === 'search' ? '' : 'hidden'}>
          <SearchPreferencesSection />
        </div>
        <div className={activeSection === 'account' ? '' : 'hidden'}>
          <AccountSection />
        </div>
        {isOrgAdmin ? (
          <div className={activeSection === 'organization' ? '' : 'hidden'}>
            <OrganizationSection />
          </div>
        ) : null}
      </div>
    </div>
  );
}
