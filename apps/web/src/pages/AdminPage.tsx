import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import AdminAuditSection from '../components/admin/AdminAuditSection';
import AdminEntityMappingSection from '../components/admin/AdminEntityMappingSection';
import AdminMembersSection from '../components/admin/AdminMembersSection';
import AdminRolesSection from '../components/admin/AdminRolesSection';
import AdminUsersSection from '../components/admin/AdminUsersSection';
import OrganizationSection from '../components/settings/OrganizationSection';

type SectionKey = 'organization' | 'users' | 'members' | 'roles' | 'entity-mapping' | 'audit';

interface SectionDef {
  key: SectionKey;
  label: string;
  // Mirrors AppShell's ADMIN_NAV_ITEMS gating (null = every viewer who reached this
  // org:admin-or-narrower-gated route at all may see this tab; a list = hidden unless the
  // viewer holds '*' or one of these). Kept in sync with the finer permission each section's
  // own mutation buttons already check internally (see AdminUsersSection/
  // AdminMembersSection/AdminEntityMappingSection's own `canManage`/`canUseGlobalScope`
  // checks) so a viewer is never shown a tab whose content is entirely read-only-or-403 for
  // them.
  permissions: string[] | null;
}

const SECTIONS: SectionDef[] = [
  { key: 'organization', label: 'Organization', permissions: ['org:admin'] },
  { key: 'users', label: 'Users', permissions: ['org:admin', 'users:read', 'users:manage', 'users:delete'] },
  // AdminMembersSection was rewritten from a flat "one org-wide role per member" picker into
  // the full role-assignment console (per-user, per-scope, dated grants) — renamed here to
  // match; the component/file name stays AdminMembersSection.
  { key: 'members', label: 'Role Assignments', permissions: ['org:admin', 'roles:assign', 'users:read'] },
  { key: 'roles', label: 'Roles', permissions: ['org:admin', 'roles:read', 'roles:manage'] },
  { key: 'entity-mapping', label: 'Entity Mapping', permissions: ['org:admin', 'entity-mapping:read', 'entity-mapping:manage'] },
  { key: 'audit', label: 'Audit Log', permissions: ['org:admin', 'audit:read'] },
];

function isSectionVisible(section: SectionDef, permissions: string[]): boolean {
  if (section.permissions === null) {
    return true;
  }
  return permissions.includes('*') || section.permissions.some((candidate) => permissions.includes(candidate));
}

function isSectionKey(value: string | null): value is SectionKey {
  return value !== null && SECTIONS.some((section) => section.key === value);
}

// Consolidates what used to be separate routes (/admin/org, /admin/members,
// /admin/roles, ...) into one /admin destination with an internal sub-nav — mirrors
// SettingsPage's exact pattern. The route itself admits anyone holding at least one
// admin-cluster permission (see App.tsx's ADMIN_CLUSTER_PERMISSIONS), so unlike the old
// single org:admin-only gate, a viewer scoped to just one narrower permission (e.g.
// entity-mapping:read, with no users:read at all) can land here too — SECTIONS' own
// `permissions` filters the sub-nav down to only what's actually useful for them,
// consistent with AppShell's own "hide, don't disable" nav convention. Individual sections
// additionally self-gate their mutation buttons at a finer grain still (see
// AdminUsersSection/AdminMembersSection/AdminEntityMappingSection's own internal checks)
// since even holding the section's own permission doesn't imply every action within it.
export default function AdminPage() {
  const { permissions } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const visibleSections = useMemo(
    () => SECTIONS.filter((section) => isSectionVisible(section, permissions)),
    [permissions],
  );

  const requestedSection = searchParams.get('section');
  const initialSection =
    requestedSection && isSectionKey(requestedSection) && visibleSections.some((s) => s.key === requestedSection)
      ? requestedSection
      : (visibleSections[0]?.key ?? 'organization');
  const [activeSection, setActiveSection] = useState<SectionKey>(initialSection);

  function selectSection(key: SectionKey) {
    setActiveSection(key);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('section', key);
      return next;
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-8 px-6 py-10">
      <nav className="w-[200px] shrink-0">
        <h1 className="mb-4 px-3 text-2xl font-semibold text-[var(--text-primary)]">Admin</h1>
        <div className="space-y-1">
          {visibleSections.map((section) => (
            <button
              key={section.key}
              type="button"
              onClick={() => selectSection(section.key)}
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

      <div className="min-w-0 flex-1 pb-16">
        <div className={activeSection === 'organization' ? '' : 'hidden'}>
          <OrganizationSection />
        </div>
        <div className={activeSection === 'users' ? '' : 'hidden'}>
          <AdminUsersSection />
        </div>
        <div className={activeSection === 'members' ? '' : 'hidden'}>
          <AdminMembersSection />
        </div>
        <div className={activeSection === 'roles' ? '' : 'hidden'}>
          <AdminRolesSection />
        </div>
        <div className={activeSection === 'entity-mapping' ? '' : 'hidden'}>
          <AdminEntityMappingSection />
        </div>
        <div className={activeSection === 'audit' ? '' : 'hidden'}>
          <AdminAuditSection />
        </div>
      </div>
    </div>
  );
}
