import { Link, NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';

interface NavItem {
  to: string;
  label: string;
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/documents', label: 'Documents' },
  { to: '/search', label: 'Search' },
  { to: '/projects', label: 'Projects' },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin/roles', label: 'Roles' },
  { to: '/admin/org', label: 'Organization' },
];

function navLinkClassName({ isActive }: { isActive: boolean }): string {
  return [
    'block rounded-md px-3 py-2 text-sm transition',
    isActive
      ? 'bg-slate-800 text-slate-100 font-medium'
      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100',
  ].join(' ');
}

export default function AppLayout() {
  const { permissions } = useAuth();
  const isOrgAdmin = permissions.includes('org:admin') || permissions.includes('*');

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-56 shrink-0 border-r border-slate-800 px-3 py-6">
        <Link to="/" className="block px-3 text-lg font-semibold text-slate-100">
          Content Insights
        </Link>

        <nav className="mt-8 space-y-1">
          {PRIMARY_NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClassName}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {isOrgAdmin ? (
          <div className="mt-8">
            <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Admin
            </h2>
            <nav className="mt-2 space-y-1">
              {ADMIN_NAV.map((item) => (
                <NavLink key={item.to} to={item.to} className={navLinkClassName}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        ) : null}
      </aside>

      <main className="flex flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
