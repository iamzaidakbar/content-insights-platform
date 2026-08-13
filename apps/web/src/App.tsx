import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import RequireAuth from './auth/RequireAuth';
import AppShell from './layouts/AppShell';
import PageSkeleton from './components/PageSkeleton';
import { TooltipProvider } from './components/ui/tooltip';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import UploadPage from './pages/UploadPage';
import GroupsPage from './pages/GroupsPage';
import GroupDetailPage from './pages/GroupDetailPage';
import AlertsPage from './pages/AlertsPage';
import TagsPage from './pages/TagsPage';
import ProfilePage from './pages/ProfilePage';

const AdminPage = lazy(() => import('./pages/AdminPage'));
const ArticlesPage = lazy(() => import('./pages/ArticlesPage'));
const ArticleDetailPage = lazy(() => import('./pages/ArticleDetailPage'));
const InsightsPage = lazy(() => import('./pages/InsightsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SavedSearchesPage = lazy(() => import('./pages/SavedSearchesPage'));
const ChannelsPage = lazy(() => import('./pages/ChannelsPage'));
const ChannelDetailPage = lazy(() => import('./pages/ChannelDetailPage'));
const DashboardsPage = lazy(() => import('./pages/DashboardsPage'));
const DashboardDetailPage = lazy(() => import('./pages/DashboardDetailPage'));

// Every admin-cluster section (Users/Role Assignments/Roles/Entity Mapping/Audit Log) is
// gated on its own finer-grained permission internally (see AdminPage's own module
// comment) — the route itself only needs to admit anyone who could see at least one of
// them, so a scoped admin (e.g. holding just entity-mapping:read, not full org:admin)
// isn't blocked from the page entirely. AppShell's individual nav entries apply the same
// per-permission OR so a viewer never sees a link to a page RequireAuth would then reject.
const ADMIN_CLUSTER_PERMISSIONS = [
  'org:admin',
  'users:read',
  'users:manage',
  'users:delete',
  'roles:read',
  'roles:manage',
  'roles:assign',
  'entity-mapping:read',
  'entity-mapping:manage',
  'audit:read',
];

export default function App() {
  return (
    <TooltipProvider delayDuration={300}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/articles" replace />} />

          <Route
            path="/articles"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <ArticlesPage />
              </Suspense>
            }
          />
          <Route path="/articles/upload" element={<UploadPage />} />
          <Route
            path="/articles/:id"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <ArticleDetailPage />
              </Suspense>
            }
          />
          <Route path="/search" element={<Navigate to="/articles" replace />} />
          {/* Pre-pivot bookmarks/links — /documents and /incidents no longer exist anywhere
              in the backend; redirect rather than 404 for anyone with an old link saved. */}
          <Route path="/documents" element={<Navigate to="/articles" replace />} />
          <Route path="/documents/:id" element={<Navigate to="/articles" replace />} />
          <Route path="/incidents" element={<Navigate to="/articles" replace />} />
          <Route path="/incidents/:id" element={<Navigate to="/articles" replace />} />

          <Route
            path="/insights"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <InsightsPage />
              </Suspense>
            }
          />

          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/groups/:id" element={<GroupDetailPage />} />

          <Route
            path="/saved-searches"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <SavedSearchesPage />
              </Suspense>
            }
          />
          <Route
            path="/channels"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <ChannelsPage />
              </Suspense>
            }
          />
          <Route
            path="/channels/:id"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <ChannelDetailPage />
              </Suspense>
            }
          />
          <Route
            path="/dashboards"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <DashboardsPage />
              </Suspense>
            }
          />
          <Route
            path="/dashboards/:id"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <DashboardDetailPage />
              </Suspense>
            }
          />

          <Route
            path="/settings"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/trends" element={<Navigate to="/dashboards" replace />} />

          <Route element={<RequireAuth anyOf={ADMIN_CLUSTER_PERMISSIONS} />}>
          <Route
            path="/admin/:section?"
            element={
              <Suspense fallback={<PageSkeleton />}>
                <AdminPage />
              </Suspense>
            }
          />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </TooltipProvider>
  );
}
