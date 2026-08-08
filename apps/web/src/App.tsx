import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import RequireAuth from './auth/RequireAuth';
import AppLayout from './layouts/AppLayout';
import PageSkeleton from './components/PageSkeleton';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DocumentsPage from './pages/DocumentsPage';
import UploadPage from './pages/UploadPage';
import SearchPage from './pages/SearchPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';

// Code-split — admin pages are only reachable by org:admin users, so most sessions never
// need this JS at all. Keeps the main bundle smaller for the common case.
const AdminRolesPage = lazy(() => import('./pages/AdminRolesPage'));
const AdminOrgPage = lazy(() => import('./pages/AdminOrgPage'));

function HomePage() {
  const { user, org, logout } = useAuth();

  return (
    <div className="text-center">
      <h1 className="text-3xl font-semibold">Content Insights Platform</h1>
      <p className="mt-2 text-slate-400">
        Signed in as {user?.email} · {org?.name}
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link
          to="/documents"
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-100 transition hover:border-slate-500"
        >
          Documents
        </Link>
        <Link
          to="/search"
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-100 transition hover:border-slate-500"
        >
          Search
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-100 transition hover:border-slate-500"
        >
          Log out
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route
            path="/"
            element={
              <div className="flex flex-1 items-center justify-center">
                <HomePage />
              </div>
            }
          />

          <Route element={<RequireAuth permission="documents:read" />}>
            <Route path="/documents" element={<DocumentsPage />} />
          </Route>
          <Route element={<RequireAuth permission="documents:write" />}>
            <Route path="/documents/upload" element={<UploadPage />} />
          </Route>
          <Route element={<RequireAuth permission="search:query" />}>
            <Route path="/search" element={<SearchPage />} />
          </Route>

          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />

          <Route element={<RequireAuth permission="org:admin" />}>
            <Route
              path="/admin/roles"
              element={
                <Suspense fallback={<PageSkeleton />}>
                  <AdminRolesPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/org"
              element={
                <Suspense fallback={<PageSkeleton />}>
                  <AdminOrgPage />
                </Suspense>
              }
            />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
