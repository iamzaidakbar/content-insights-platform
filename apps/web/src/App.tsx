import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import RequireAuth from './auth/RequireAuth';
import AppShell from './layouts/AppShell';
import PageSkeleton from './components/PageSkeleton';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import UploadPage from './pages/UploadPage';
import SearchPage from './pages/SearchPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import TrendsPage from './pages/TrendsPage';
import AlertsPage from './pages/AlertsPage';
import TagsPage from './pages/TagsPage';
import ProfilePage from './pages/ProfilePage';

// Code-split — admin pages are only reachable by org:admin users, so most sessions never
// need this JS at all. Keeps the main bundle smaller for the common case.
const AdminRolesPage = lazy(() => import('./pages/AdminRolesPage'));
const AdminOrgPage = lazy(() => import('./pages/AdminOrgPage'));
const AdminMembersPage = lazy(() => import('./pages/AdminMembersPage'));
// Split separately too — its toolbar (icon set, filter/sort popovers, results grid) is
// the single largest contributor to the main bundle, enough on its own to push the
// bundle-size budget (build.chunkSizeWarningLimit, vite.config.ts) over 250kB.
const ArticlesPage = lazy(() => import('./pages/ArticlesPage'));
// Six independent settings sections (Appearance's theme-card SVGs, the change-password
// form, org management, ...) add up fast — most sessions never open Settings, so none of
// that JS belongs in the main bundle.
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function HomePage() {
  const { user, org } = useAuth();

  return (
    <div className="text-center">
      <h1 className="text-3xl font-semibold text-[var(--text-primary)]">
        Content Insights Platform
      </h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        Signed in as {user?.email} · {org?.name}
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link
          to="/documents"
          className="rounded-[var(--radius-button)] border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-primary)] transition hover:border-[var(--accent)]"
        >
          Articles
        </Link>
        <Link
          to="/search"
          className="rounded-[var(--radius-button)] border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-primary)] transition hover:border-[var(--accent)]"
        >
          Search
        </Link>
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
        <Route element={<AppShell />}>
          <Route
            path="/"
            element={
              <div className="flex flex-1 items-center justify-center">
                <HomePage />
              </div>
            }
          />

          <Route element={<RequireAuth permission="documents:read" />}>
            <Route
              path="/documents"
              element={
                <Suspense fallback={<PageSkeleton />}>
                  <ArticlesPage />
                </Suspense>
              }
            />
          </Route>
          <Route element={<RequireAuth permission="documents:write" />}>
            <Route path="/documents/upload" element={<UploadPage />} />
          </Route>
          <Route element={<RequireAuth permission="search:query" />}>
            <Route path="/search" element={<SearchPage />} />
          </Route>

          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />

          <Route
            path="/settings"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route path="/trends" element={<TrendsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/profile" element={<ProfilePage />} />

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
            <Route
              path="/admin/members"
              element={
                <Suspense fallback={<PageSkeleton />}>
                  <AdminMembersPage />
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
