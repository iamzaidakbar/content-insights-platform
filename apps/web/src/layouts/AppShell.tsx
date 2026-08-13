import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  LayoutDashboard,
  LogOut,
  Menu,
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
  X,
} from 'lucide-react';

import type { User } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import ErrorBoundary from '../components/ErrorBoundary';
import NotificationBell from '../components/NotificationBell';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { cn } from '../lib/cn';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  permissions: string[] | null;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  { to: '/articles', label: 'Articles', icon: Newspaper, permissions: null },
  { to: '/dashboards', label: 'Dashboards', icon: LayoutDashboard, permissions: null },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, permissions: null },
];

const WORKSPACE_NAV_ITEMS: NavItem[] = [
  { to: '/saved-searches', label: 'Saved Searches', icon: Bookmark, permissions: null },
  { to: '/channels', label: 'Channels', icon: Rss, permissions: null },
  { to: '/insights', label: 'Insights', icon: BarChart3, permissions: null },
];

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

const SIDEBAR_EXPANDED = 232;
const SIDEBAR_COMPACT = 64;

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

function isNavItemVisible(item: NavItem, permissions: string[]): boolean {
  if (item.permissions === null) {
    return true;
  }
  return permissions.includes('*') || item.permissions.some((candidate) => permissions.includes(candidate));
}

function NavSectionLabel({ label, compact }: { label: string; compact: boolean }) {
  if (compact) {
    return <div className="mx-2 my-2 h-px bg-[var(--border)]" aria-hidden />;
  }
  return (
    <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
      {label}
    </p>
  );
}

function NavList({
  items,
  compact,
  onNavigate,
}: {
  items: NavItem[];
  compact: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            end={item.to === '/articles'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-[var(--radius-button)] px-3 py-2 text-sm transition-colors',
                compact && 'justify-center px-2',
                isActive
                  ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
              )
            }
          >
            <Icon size={18} strokeWidth={1.75} />
            {!compact ? <span className="truncate">{item.label}</span> : null}
          </NavLink>
        );
      })}
    </>
  );
}

const INSIGHTS_SYNC_WARNING_KEY = 'ci:articles-leave-warning-shown';

function hasShownInsightsSyncWarning(): boolean {
  try {
    return window.sessionStorage.getItem(INSIGHTS_SYNC_WARNING_KEY) === '1';
  } catch {
    return false;
  }
}

function markInsightsSyncWarningShown(): void {
  try {
    window.sessionStorage.setItem(INSIGHTS_SYNC_WARNING_KEY, '1');
  } catch {
    // ignore
  }
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
  const isDesktop = useIsDesktop();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [compact, setCompact] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const pageTitle = pageTitleFor(location.pathname);
  const visibleAdminNavItems = ADMIN_NAV_ITEMS.filter((item) => isNavItemVisible(item, permissions));
  const insightsSyncWarning = useInsightsSyncLeaveWarning(location.pathname);

  useEffect(() => {
    document.title = `${pageTitle} · Content Insights`;
  }, [pageTitle]);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  const sidebarWidth = isDesktop ? (compact ? SIDEBAR_COMPACT : SIDEBAR_EXPANDED) : 0;
  const showExpandedLabels = isDesktop ? !compact : true;

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  const sidebarContent = (
    <>
      <div className={cn('flex items-center gap-2 px-3 pb-4 pt-1', !showExpandedLabels && 'justify-center')}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-button)] text-sm font-bold text-white"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            C
          </div>
          {showExpandedLabels ? (
            <span className="truncate text-sm font-semibold text-[var(--text-primary)]">Content Insights</span>
          ) : null}
        </div>
        {isDesktop && showExpandedLabels ? (
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
        {!isDesktop ? (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="rounded-[var(--radius-button)] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X size={18} />
          </button>
        ) : null}
      </div>

      {isDesktop && compact ? (
        <button
          type="button"
          onClick={() => setCompact(false)}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="mx-auto mb-2 rounded-[var(--radius-button)] p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        </button>
      ) : null}

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        <NavSectionLabel label="Main" compact={!showExpandedLabels} />
        <NavList items={MAIN_NAV_ITEMS} compact={!showExpandedLabels} onNavigate={() => setMobileOpen(false)} />

        <NavSectionLabel label="Workspace" compact={!showExpandedLabels} />
        <NavList items={WORKSPACE_NAV_ITEMS} compact={!showExpandedLabels} onNavigate={() => setMobileOpen(false)} />

        {visibleAdminNavItems.length > 0 ? (
          <>
            <NavSectionLabel label="Admin" compact={!showExpandedLabels} />
            <NavList
              items={visibleAdminNavItems}
              compact={!showExpandedLabels}
              onNavigate={() => setMobileOpen(false)}
            />
          </>
        ) : null}
      </nav>

      <div className="mt-auto border-t border-[var(--border)] px-2 pt-2">
        <button
          type="button"
          title="Log out"
          onClick={() => void handleLogout()}
          disabled={isLoggingOut}
          className={cn(
            'flex w-full items-center gap-3 rounded-[var(--radius-button)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--error)] disabled:opacity-60',
            !showExpandedLabels && 'justify-center px-2',
          )}
        >
          <LogOut size={18} strokeWidth={1.75} />
          {showExpandedLabels ? <span>Log out</span> : null}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-full overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-[var(--radius-button)] focus:bg-[var(--bg-surface)] focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--text-primary)] focus:outline-none"
      >
        Skip to main content
      </a>
      {/* Desktop sidebar */}
      {isDesktop ? (
        <aside
          style={{ width: sidebarWidth }}
          className="flex h-full shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)] py-3 transition-[width] duration-150 motion-reduce:transition-none"
        >
          {sidebarContent}
        </aside>
      ) : null}

      {/* Mobile overlay sidebar */}
      {!isDesktop && mobileOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-[min(280px,85vw)] flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)] py-3 shadow-[var(--shadow-md)]">
            {sidebarContent}
          </aside>
        </>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            {!isDesktop ? (
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
                className="rounded-[var(--radius-button)] p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <Menu size={20} strokeWidth={1.75} />
              </button>
            ) : null}
            <h1 className="truncate text-base font-semibold sm:text-lg">{pageTitle}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <NotificationBell />
            <Link to="/profile" className="flex items-center gap-2.5 rounded-[var(--radius-button)] p-0.5 hover:bg-[var(--bg-hover)]" title="Profile">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {user ? initialsFromUser(user) : '?'}
              </div>
              {user ? (
                <div className="hidden text-sm leading-tight md:block">
                  <p className="font-medium text-[var(--text-primary)]">{resolveDisplayName(user)}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{user.email}</p>
                </div>
              ) : null}
            </Link>
          </div>
        </header>

        <main
          id="main-content"
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden',
            location.pathname === '/admin' ? 'overflow-hidden' : 'overflow-y-auto',
          )}
        >
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <ConfirmDialog
        open={insightsSyncWarning.isVisible}
        onClose={insightsSyncWarning.dismiss}
        onConfirm={insightsSyncWarning.dismiss}
        title="You left Articles"
        description="Any Insight you were building from that search stops syncing to live results until you reopen it from Articles."
        confirmLabel="Got it"
        showCancel={false}
        icon={<AlertTriangle size={18} strokeWidth={1.75} />}
      />
    </div>
  );
}
