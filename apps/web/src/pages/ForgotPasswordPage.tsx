import { Link } from 'react-router-dom';

import { Card, CardBody } from '../components/ui/Card';

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-4 text-[var(--text-primary)]">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-xl font-semibold tracking-tight">Forgot password</h1>
        <Card>
          <CardBody className="space-y-3 p-6 text-sm text-[var(--text-secondary)] sm:p-8">
            <p>
              This deployment does not send email. Ask an Application Admin to generate a password-reset
              link from Admin → Users and share it with you out of band.
            </p>
            <p>
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
