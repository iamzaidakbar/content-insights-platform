import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from './AuthContext';

interface RequireAuthProps {
  permission?: string;
  anyOf?: string[];
}

export default function RequireAuth({ permission, anyOf }: RequireAuthProps) {
  const { isLoading, user, permissions } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <p className="text-sm text-[var(--text-secondary)]">Loading…</p>
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
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Forbidden</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">You don&apos;t have permission to view this page.</p>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
