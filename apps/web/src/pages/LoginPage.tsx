import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import type { ApiResponse } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import { apiClient, getApiErrorMessage } from '../lib/api-client';
import { env } from '../lib/env';
import Alert from '../components/ui/alert';
import Button from '../components/ui/button';
import { Card, CardBody } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

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
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-lg font-bold text-primary-foreground">
            C
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Content Insights</h1>
            <p className="mt-1 text-sm text-muted-foreground">Welcome back — log in to continue.</p>
          </div>
        </div>

        <Card>
          <CardBody className="p-6 sm:p-8">
            {ssoQuery.data?.enabled ? (
              <>
                <a
                  href={`${env.apiUrl}/auth/sso/login`}
                  className="flex h-9 w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Sign in with SSO
                </a>
                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-xs text-muted-foreground">or email</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </>
            ) : null}

            <form className="space-y-4" onSubmit={handleSubmit}>
              {error ? <Alert variant="error">{error}</Alert> : null}
              <div>
                <Label htmlFor="email" className="text-muted-foreground">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="password" className="text-muted-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1"
                />
                <p className="mt-1 text-right text-xs">
                  <Link to="/forgot-password" className="text-primary hover:underline">
                    Forgot password?
                  </Link>
                </p>
              </div>

              <Button
                type="submit"
                loading={isSubmitting}
                variant={ssoQuery.data?.enabled ? 'outline' : 'primary'}
                className="w-full"
              >
                {isSubmitting ? 'Logging in…' : 'Log in'}
              </Button>
            </form>
          </CardBody>
        </Card>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="font-medium text-primary hover:text-primary/90">
            Register
          </Link>
        </p>
      </div>
    </main>
  );
}
