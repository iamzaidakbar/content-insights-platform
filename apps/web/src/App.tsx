import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import RequireAuth from './auth/RequireAuth';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

function HomePage() {
  const { user, org, logout } = useAuth();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Content Insights Platform</h1>
        <p className="mt-2 text-slate-400">
          Signed in as {user?.email} · {org?.name}
        </p>
        <button
          type="button"
          onClick={() => void logout()}
          className="mt-6 rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-100 transition hover:border-slate-500"
        >
          Log out
        </button>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
