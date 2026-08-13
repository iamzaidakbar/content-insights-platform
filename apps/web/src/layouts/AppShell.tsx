import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bookmark,
  LayoutDashboard,
  LogOut,
  Newspaper,
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
import WorkspaceContextSwitcher from '../components/WorkspaceContextSwitcher';
import CommandPalette from '../components/CommandPalette';
import ErrorBoundary from '../components/ErrorBoundary';
import ModeToggle from '../components/ModeToggle';
import NotificationBell from '../components/NotificationBell';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '../components/ui/sidebar';
import { cn } from '../lib/cn';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
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
    to: '/admin/users',
    label: 'Users',
    icon: UserCog,
    permissions: ['org:admin', 'users:read', 'users:manage', 'users:delete'],
  },
  { to: '/groups', label: 'User Groups', icon: Users, permissions: null },
  { to: '/tags', label: 'User Tags', icon: Tag, permissions: null },
  {
    to: '/admin/entity-mapping',
    label: 'Mapping',
    icon: Shuffle,
    permissions: ['org:admin', 'entity-mapping:read', 'entity-mapping:manage'],
  },
  {
    to: '/admin/audit',
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
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith('/articles/')) return 'Article';
  if (pathname.startsWith('/channels/')) return 'Channel';
  if (pathname.startsWith('/dashboards/')) return 'Dashboard';
  if (pathname.startsWith('/groups/')) return 'User Group';
  if (pathname.startsWith('/admin')) return 'Admin';
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
  if (item.permissions === null) return true;
  return permissions.includes('*') || item.permissions.some((candidate) => permissions.includes(candidate));
}

function isItemActive(pathname: string, to: string): boolean {
  if (to === '/articles') return pathname === '/articles' || pathname.startsWith('/articles/');
  return pathname === to || pathname.startsWith(`${to}/`);
}

function NavGroup({
  label,
  items,
}: {
  label: string;
  items: NavItem[];
}) {
  const location = useLocation();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton asChild isActive={isItemActive(location.pathname, item.to)} tooltip={item.label}>
                  <NavLink to={item.to} end={item.to === '/articles'}>
                    <Icon className="size-4" />
                    <span>{item.label}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
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
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const pageTitle = pageTitleFor(location.pathname);
  const visibleAdminNavItems = ADMIN_NAV_ITEMS.filter((item) => isNavItemVisible(item, permissions));
  const insightsSyncWarning = useInsightsSyncLeaveWarning(location.pathname);

  useEffect(() => {
    document.title = `${pageTitle} · Content Insights`;
  }, [pageTitle]);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/articles">
                  <div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                    C
                  </div>
                  <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
                    Content Insights
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavGroup label="Main" items={MAIN_NAV_ITEMS} />
          <NavGroup label="Workspace" items={WORKSPACE_NAV_ITEMS} />
          {visibleAdminNavItems.length > 0 ? <NavGroup label="Admin" items={visibleAdminNavItems} /> : null}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => void handleLogout()} disabled={isLoggingOut}>
                <LogOut className="size-4" />
                <span>Log out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger />
            <h1 className="truncate text-base font-semibold">{pageTitle}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <WorkspaceContextSwitcher />
            <ModeToggle />
            <NotificationBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 gap-2 px-1.5">
                  <Avatar size="sm">
                    <AvatarFallback>{user ? initialsFromUser(user) : '?'}</AvatarFallback>
                  </Avatar>
                  {user ? (
                    <span className="hidden max-w-40 truncate text-left text-sm md:block">
                      {resolveDisplayName(user)}
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {user ? (
                  <>
                    <DropdownMenuLabel className="font-normal">
                      <p className="truncate text-sm font-medium">{resolveDisplayName(user)}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
                <DropdownMenuItem asChild>
                  <Link to="/profile">Profile</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings">Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void handleLogout()} disabled={isLoggingOut}>
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main
          id="main-content"
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden',
            location.pathname.startsWith('/admin') ? 'overflow-hidden' : 'overflow-y-auto',
          )}
        >
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </SidebarInset>

      <CommandPalette />

      <ConfirmDialog
        open={insightsSyncWarning.isVisible}
        onClose={insightsSyncWarning.dismiss}
        onConfirm={insightsSyncWarning.dismiss}
        title="You left Articles"
        description="Any Insight you were building from that search stops syncing to live results until you reopen it from Articles."
        confirmLabel="Got it"
        showCancel={false}
        icon={<AlertTriangle className="size-4" />}
      />
    </SidebarProvider>
  );
}
