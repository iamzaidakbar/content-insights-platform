import { useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  Home,
  LogOut,
  Newspaper,
  Settings as SettingsIcon,
  Tag,
  TrendingUp,
  User as UserIcon,
  Users,
} from 'lucide-react';

import type { User } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

// Fixed, deliberate set — not every existing route has an entry here (e.g. the
// project/role admin pages built earlier have no icon in this shell's nav). See the
// implementation notes for why: this list matches the app-shell spec exactly rather
// than trying to surface every route that happens to exist.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/documents', label: 'Articles', icon: Newspaper },
  { to: '/trends', label: 'Trends', icon: TrendingUp },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/profile', label: 'User', icon: UserIcon },
  { to: '/projects', label: 'Groups', icon: Users },
  { to: '/tags', label: 'Tags', icon: Tag },
];

const PAGE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/documents': 'Articles',
  '/documents/upload': 'Upload',
  '/search': 'Search',
  '/trends': 'Trends',
  '/settings': 'Settings',
  '/alerts': 'Alerts',
  '/profile': 'User',
  '/projects': 'Groups',
  '/tags': 'Tags',
  '/admin/roles': 'Roles',
  '/admin/org': 'Organization',
};

function pageTitleFor(pathname: string): string {
  if (PAGE_TITLES[pathname]) {
    return PAGE_TITLES[pathname];
  }
  // Fall back to the nearest ancestor segment, e.g. /projects/:id -> "Groups".
  const topSegment = `/${pathname.split('/')[1] ?? ''}`;
  return PAGE_TITLES[topSegment] ?? 'Content Insights';
}

function displayNameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? email;
  return localPart
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// The Account settings section lets a user set a real displayName — prefer it everywhere
// a human-readable name is shown, falling back to the email-derived name only until they do.
function resolveDisplayName(user: User): string {
  return user.displayName?.trim() || displayNameFromEmail(user.email);
}

function initialsFromUser(user: User): string {
  const name = resolveDisplayName(user);
  const parts = name.split(' ').filter(Boolean);
  const first = parts[0]?.[0] ?? user.email[0] ?? '?';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

// Native <select>s styled to match the design system rather than a hand-rolled ARIA
// listbox — gets correct keyboard/screen-reader behavior for free. Both are
// presentational placeholders: no Project/Feed backend concept exists yet to back them
// with real data (this task's only backend deliverable is UserSettings), so the options
// below are static.
function ChromeSelect({ options, value }: { options: string[]; value: string }) {
  return (
    <div className="relative">
      <select
        defaultValue={value}
        className="appearance-none rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] py-2 pl-3 pr-8 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
      />
    </div>
  );
}

function navLinkClassName(isActive: boolean, compact: boolean): string {
  return [
    'flex items-center gap-3 rounded-[var(--radius-button)] px-3 py-2.5 text-sm transition-colors',
    compact ? 'justify-center' : '',
    isActive
      ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-medium'
      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
  ]
    .filter(Boolean)
    .join(' ');
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const location = useLocation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const compact = settings.appearance.compactSidebar;
  const sidebarWidth = compact ? 60 : 220;
  const pageTitle = pageTitleFor(location.pathname);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <aside
        style={{ width: sidebarWidth }}
        className="flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)] py-4 transition-[width] duration-150"
      >
        <div className={`flex items-center gap-2 px-3 pb-6 ${compact ? 'justify-center' : ''}`}>
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-button)] font-bold text-white"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            P
          </div>
          {!compact ? <span className="text-sm font-semibold">Pingar</span> : null}
        </div>

        <nav className="flex-1 space-y-1 px-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={item.label}
                className={({ isActive }) => navLinkClassName(isActive, compact)}
              >
                <Icon size={18} strokeWidth={1.75} />
                {!compact ? <span>{item.label}</span> : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="px-2 pt-2">
          <button
            type="button"
            title="Log out"
            onClick={() => void handleLogout()}
            disabled={isLoggingOut}
            className={`flex w-full items-center gap-3 rounded-[var(--radius-button)] px-3 py-2.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--red)] disabled:opacity-60 ${compact ? 'justify-center' : ''}`}
          >
            <LogOut size={18} strokeWidth={1.75} />
            {!compact ? <span>Log out</span> : null}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-3">
          <h1 className="shrink-0 text-lg font-semibold">{pageTitle}</h1>

          <div className="flex flex-1 items-center justify-center gap-3">
            <ChromeSelect options={['CPD (Default)']} value="CPD (Default)" />
            <ChromeSelect options={['English News', 'All Languages']} value="English News" />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {user ? initialsFromUser(user) : '?'}
            </div>
            {user ? (
              <div className="hidden text-sm leading-tight sm:block">
                <p className="font-medium text-[var(--text-primary)]">
                  {resolveDisplayName(user)}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">{user.email}</p>
              </div>
            ) : null}
          </div>
        </header>

        <main className="flex flex-1 flex-col overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
