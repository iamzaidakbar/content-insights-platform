import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from './AuthContext';

interface RequireAuthProps {
  permission?: string;
  // Alternate to `permission` for routes reachable by any of several distinct permissions
  // (e.g. /admin, whose internal sections each gate on a different one) — passes if the
  // viewer holds '*' or any single entry, same OR semantics AppShell's own nav gating uses.
  anyOf?: string[];
}

export default function RequireAuth({ permission, anyOf }: RequireAuthProps) {
  const { isLoading, user, permissions } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <p className="text-slate-400">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const hasWildcard = permissions.includes('*');
  const passesSingle = !permission || hasWildcard || permissions.includes(permission);
  const passesAnyOf = !anyOf || hasWildcard || anyOf.some((candidate) => permissions.includes(candidate));

  if (!passesSingle || !passesAnyOf) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Forbidden</h1>
          <p className="mt-2 text-slate-400">You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
