import { useAuth } from '../auth/AuthContext';
import { Badge, Card, CardBody, PageBody, PageHeader } from '../components/ui';

export default function ProfilePage() {
  const { user, org, permissions } = useAuth();

  return (
    <PageBody width="sm">
      <PageHeader title="User" description="Your account details." />

      <Card>
        <CardBody className="space-y-4">
          <div>
            <span className="block text-sm font-medium text-[var(--text-secondary)]">Email</span>
            <p className="mt-1 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]">
              {user?.email ?? '—'}
            </p>
          </div>

          <div>
            <span className="block text-sm font-medium text-[var(--text-secondary)]">Organization</span>
            <p className="mt-1 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]">
              {org?.name ?? '—'}
            </p>
          </div>

          <div>
            <span className="block text-sm font-medium text-[var(--text-secondary)]">Permissions</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {permissions.map((permission) => (
                <Badge key={permission} variant="default">
                  {permission}
                </Badge>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>
    </PageBody>
  );
}
