import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { apiClient, getApiErrorMessage } from '../lib/api-client';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Input } from '../components/ui/Input';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await apiClient.post('/auth/reset-password', { token, password }, { skipAuthRefresh: true });
      if (!response.data.success) {
        throw new Error(response.data.message);
      }
      navigate('/login', { replace: true });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Unable to reset this password.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4 text-[var(--text-primary)]">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-xl font-semibold tracking-tight">Set a new password</h1>
        <Card>
          <CardBody className="p-6 sm:p-8">
            {!token ? (
              <Alert variant="error">This reset link is missing a token. Ask an admin for a new one.</Alert>
            ) : (
              <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
                {error ? <Alert variant="error">{error}</Alert> : null}
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-[var(--text-secondary)]">
                    New password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-1"
                  />
                </div>
                <Button type="submit" className="w-full" loading={isSubmitting}>
                  Save password
                </Button>
              </form>
            )}
            <p className="mt-4 text-center text-sm text-[var(--text-secondary)]">
              <Link to="/login" className="text-[var(--accent)] hover:underline">
                Back to log in
              </Link>
            </p>
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
