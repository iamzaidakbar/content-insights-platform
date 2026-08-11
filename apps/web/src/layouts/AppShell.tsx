import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  LayoutDashboard,
  LogOut,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Rss,
  ScrollText,
  Settings as SettingsIcon,
  Shuffle,
  Tag,
  UserCog,
  Users,
} from 'lucide-react';

import type { User } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import ErrorBoundary from '../components/ErrorBoundary';
import NotificationBell from '../components/NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  // null = visible to every authenticated user (matches the linked page's own, looser,
  // server-side access rule — e.g. GET /groups and /tags have no permission gate at all).
  // A string[] hides the entry unless the viewer holds '*' or at least one of them — same
  // flat org-wide `permissions` array + OR semantics AppShell already used for the old
  // single '/admin' link, just applied per-entry now that admin destinations are split out.
  permissions: string[] | null;
}

// Primary nav: the three everyday destinations, always visible once authenticated.
const MAIN_NAV_ITEMS: NavItem[] = [
  { to: '/articles', label: 'Articles', icon: Newspaper, permissions: null },
  { to: '/dashboards', label: 'Dashboards', icon: LayoutDashboard, permissions: null },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, permissions: null },
];

// Workspace nav: everything else a regular contributor still needs a persistent link to
// (Saved Searches/Channels have their own share-link flows, but the list pages themselves
// need a way in) — every seeded role reads at least these (see SYSTEM_ROLE_PERMISSIONS),
// so unlike the admin cluster below these aren't worth per-entry gating.
const WORKSPACE_NAV_ITEMS: NavItem[] = [
  { to: '/saved-searches', label: 'Saved Searches', icon: Bookmark, permissions: null },
  { to: '/channels', label: 'Channels', icon: Rss, permissions: null },
  { to: '/insights', label: 'Insights', icon: BarChart3, permissions: null },
];

// Admin cluster — Users/Mapping/User Logs land inside AdminPage's internal sections (which
// self-gate mutation buttons further; see AdminPage's own comment) and are hidden here
// entirely for a viewer who holds none of the permissions that would make that section
// useful. User Groups/User Tags are the existing standalone Groups/Tags pages, renamed to
// match this cluster's naming and left ungated — their own routes have no view-level
// permission requirement server-side (any org member may already reach them).
const ADMIN_NAV_ITEMS: NavItem[] = [
  {
    to: '/admin?section=users',
    label: 'Users',
    icon: UserCog,
    permissions: ['org:admin', 'users:read', 'users:manage', 'users:delete'],
  },
  { to: '/groups', label: 'User Groups', icon: Users, permissions: null },
  { to: '/tags', label: 'User Tags', icon: Tag, permissions: null },
  {
    to: '/admin?section=entity-mapping',
    label: 'Mapping',
    icon: Shuffle,
    permissions: ['org:admin', 'entity-mapping:read', 'entity-mapping:manage'],
  },
  {
    to: '/admin?section=audit',
    label: 'User Logs',
    icon: ScrollText,
    permissions: ['org:admin', 'audit:read'],
  },
];

const PAGE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/articles': 'Articles',
  '/articles/upload': 'Upload',
  '/insights': 'Insights',
  '/saved-searches': 'Saved Searches',
  '/channels': 'Channels',
  '/dashboards': 'Dashboards',
  '/settings': 'Settings',
  '/alerts': 'Notifications',
  '/tags': 'User Tags',
  '/groups': 'User Groups',
  '/admin': 'Admin',
  '/profile': 'Profile',
};

function pageTitleFor(pathname: string): string {
  if (PAGE_TITLES[pathname]) {
    return PAGE_TITLES[pathname];
  }
  if (pathname.startsWith('/articles/')) {
    return 'Article';
  }
  if (pathname.startsWith('/channels/')) {
    return 'Channel';
  }
  if (pathname.startsWith('/dashboards/')) {
    return 'Dashboard';
  }
  if (pathname.startsWith('/groups/')) {
    return 'User Group';
  }
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

function isNavItemVisible(item: NavItem, permissions: string[]): boolean {
  if (item.permissions === null) {
    return true;
  }
  return permissions.includes('*') || item.permissions.some((candidate) => permissions.includes(candidate));
}

function NavList({ items, compact }: { items: NavItem[]; compact: boolean }) {
  return (
    <>
      {items.map((item) => {
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
    </>
  );
}

// ---------------------------------------------------------------------------------------
// Insights <-> Articles sync warning — a one-time-per-browser-session notice that leaving
// the Articles list stops any Insight built from its current search from syncing to live
// results (it keeps whatever snapshot it last saw). This app uses plain <Routes> rather
// than a data router, so v6's `useBlocker`/`unstable_usePrompt` (which require one) aren't
// available for a real "confirm before you leave" interstitial — that would need routing
// this whole app onto createBrowserRouter, well beyond an integration/cleanup pass. This is
// the lightweight, real alternative: AppShell wraps every authenticated route, so it can
// watch for the one transition that matters (pathname was exactly /articles, now isn't) and
// surface the same warning immediately after, gated by a sessionStorage flag so it fires at
// most once per browser session regardless of how many times the user leaves and returns.
// ---------------------------------------------------------------------------------------
const INSIGHTS_SYNC_WARNING_KEY = 'ci:articles-leave-warning-shown';

function hasShownInsightsSyncWarning(): boolean {
  try {
    return window.sessionStorage.getItem(INSIGHTS_SYNC_WARNING_KEY) === '1';
  } catch {
    // Storage disabled (private browsing, hardened settings, etc.) — fail open to "not shown
    // yet" rather than crash; worst case the notice can reappear across reloads that session.
    return false;
  }
}

function markInsightsSyncWarningShown(): void {
  try {
    window.sessionStorage.setItem(INSIGHTS_SYNC_WARNING_KEY, '1');
  } catch {
    // Same tolerance as the read above — nothing meaningful to recover into.
  }
}

function InsightsSyncWarningModal({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onDismiss}>
      <div
        className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--amber)]"
            style={{ backgroundColor: 'var(--accent-soft)' }}
          >
            <AlertTriangle size={18} strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">You left Articles</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Any Insight you were building from that search stops syncing to live results until you reopen it from
              Articles.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

function useInsightsSyncLeaveWarning(pathname: string): { isVisible: boolean; dismiss: () => void } {
  const [isVisible, setIsVisible] = useState(false);
  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    if (previousPathname === '/articles' && pathname !== '/articles' && !hasShownInsightsSyncWarning()) {
      markInsightsSyncWarningShown();
      setIsVisible(true);
    }
  }, [pathname]);

  return { isVisible, dismiss: () => setIsVisible(false) };
}

export default function AppShell() {
  const { user, permissions, logout } = useAuth();
  const location = useLocation();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // Post-pivot UserSettings dropped the old appearance.compactSidebar field entirely (see
  // apply-settings.ts's own comment) along with the rest of the pre-pivot appearance/search/
  // notifications nesting — there's nothing left server-side to persist this against. Kept
  // as plain client-only UI state instead of losing the collapse feature outright; it simply
  // resets to expanded on reload rather than round-tripping through the API.
  const [compact, setCompact] = useState(false);

  const sidebarWidth = compact ? 60 : 220;
  const pageTitle = pageTitleFor(location.pathname);

  const visibleAdminNavItems = ADMIN_NAV_ITEMS.filter((item) => isNavItemVisible(item, permissions));
  const insightsSyncWarning = useInsightsSyncLeaveWarning(location.pathname);

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
        <div className={`flex items-center gap-2 px-3 pb-6 ${compact ? 'justify-center' : 'justify-between'}`}>
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-button)] font-bold text-white"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              C
            </div>
            {!compact ? <span className="truncate text-sm font-semibold">Content Insights</span> : null}
          </div>
          {!compact ? (
            <button
              type="button"
              onClick={() => setCompact(true)}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
              className="shrink-0 rounded-[var(--radius-button)] p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <PanelLeftClose size={16} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        {compact ? (
          <button
            type="button"
            onClick={() => setCompact(false)}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="mx-auto mb-4 rounded-[var(--radius-button)] p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <PanelLeftOpen size={16} strokeWidth={1.75} />
          </button>
        ) : null}

        <nav className="flex-1 space-y-1 px-2">
          <NavList items={MAIN_NAV_ITEMS} compact={compact} />
          <div className="my-2 h-px bg-[var(--border)]" />
          <NavList items={WORKSPACE_NAV_ITEMS} compact={compact} />
        </nav>

        <div className="space-y-1 border-t border-[var(--border)] px-2 pt-2">
          {visibleAdminNavItems.length > 0 ? <NavList items={visibleAdminNavItems} compact={compact} /> : null}

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

          <div className="flex shrink-0 items-center gap-3">
            <NotificationBell />
            <Link to="/profile" className="flex items-center gap-3" title="Profile">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {user ? initialsFromUser(user) : '?'}
              </div>
              {user ? (
                <div className="hidden text-sm leading-tight sm:block">
                  <p className="font-medium text-[var(--text-primary)]">{resolveDisplayName(user)}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{user.email}</p>
                </div>
              ) : null}
            </Link>
          </div>
        </header>

        <main className="flex flex-1 flex-col overflow-y-auto">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {insightsSyncWarning.isVisible ? <InsightsSyncWarningModal onDismiss={insightsSyncWarning.dismiss} /> : null}
    </div>
  );
}
