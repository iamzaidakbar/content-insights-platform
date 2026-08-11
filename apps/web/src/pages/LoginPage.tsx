import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import type { ApiResponse } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import { apiClient, getApiErrorMessage } from '../lib/api-client';
import { env } from '../lib/env';
import { INPUT_CLASSNAME } from '../lib/form-styles';

interface LocationState {
  from?: { pathname: string };
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ssoQuery = useQuery({
    queryKey: ['sso-status'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<{ enabled: boolean }>>('/auth/sso/status', {
        skipAuthRefresh: true,
      });
      if (!response.data.success) throw new Error(response.data.message);
      return response.data.data;
    },
    staleTime: 60_000,
    retry: false,
  });

  const state = location.state as LocationState | null;
  const redirectTo = state?.from?.pathname ?? '/';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to log in. Check your credentials and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4 text-[var(--text-primary)]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-button)] text-lg font-bold text-white"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            C
          </div>
          <div>
            <h1 className="text-lg font-semibold">Content Insights</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Welcome back — log in to continue.</p>
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-8">
          {/* When SSO is configured it's the prominent, primary path — but the email/password
              form below is never hidden behind a click. This is the app's break-glass login
              path (e.g. an org admin locked out of a misconfigured SSO provider), so it must
              stay visibly reachable at all times, not just discoverable once SSO fails. */}
          {ssoQuery.data?.enabled ? (
            <>
              <a
                href={`${env.apiUrl}/auth/sso/login`}
                className="flex w-full items-center justify-center rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
              >
                Sign in with SSO
              </a>
              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-[var(--border)]" />
                <span className="text-xs text-[var(--text-muted)]">or sign in with email instead</span>
                <div className="h-px flex-1 bg-[var(--border)]" />
              </div>
            </>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[var(--text-secondary)]">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={`mt-1 ${INPUT_CLASSNAME}`}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[var(--text-secondary)]">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`mt-1 ${INPUT_CLASSNAME}`}
              />
            </div>

            {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full rounded-[var(--radius-button)] px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                ssoQuery.data?.enabled
                  ? 'border border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--accent)]'
                  : 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
              }`}
            >
              {isSubmitting ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-[var(--text-secondary)]">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="font-medium text-[var(--accent)] hover:text-[var(--accent-hover)]">
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}
