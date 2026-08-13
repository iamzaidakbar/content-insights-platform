import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { useAuth } from '../auth/AuthContext';
import { getApiErrorMessage } from '../lib/api-client';
import { fetchAuthSessions, revokeAuthSession } from '../lib/auth-sessions-api';
import { formatDate } from '../lib/format';
import { fetchTeamsShares } from '../lib/teams-api';
import { Badge, Button, Card, CardBody, PageBody, PageHeader } from '../components/ui';

export default function ProfilePage() {
  const { user, org, permissions } = useAuth();
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({ queryKey: ['auth-sessions'], queryFn: fetchAuthSessions });
  const canShareTeams = permissions.includes('*') || permissions.includes('ms-teams:share');
  const sharesQuery = useQuery({
    queryKey: ['teams-shares'],
    queryFn: () => fetchTeamsShares(1),
    enabled: canShareTeams,
  });

  const revokeMutation = useMutation({
    mutationFn: revokeAuthSession,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
      toast.success('Session revoked.');
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to revoke session.')),
  });

  return (
    <PageBody>
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

      <Card className="mt-4">
        <CardBody className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Active sessions</h2>
          {(sessionsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">No refresh sessions found.</p>
          ) : (
            <ul className="space-y-2">
              {(sessionsQuery.data ?? []).map((session) => (
                <li
                  key={session.jti}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-input)] border border-[var(--border)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--text-primary)]">
                      {session.userAgent ?? 'Browser session'}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {formatDate(session.createdAt)}
                      {session.ip ? ` · ${session.ip}` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => revokeMutation.mutate(session.jti)}
                    loading={revokeMutation.isPending}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canShareTeams ? (
        <Card className="mt-4">
          <CardBody className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Teams share history</h2>
            <p className="text-xs text-[var(--text-muted)]">
              Recorded shares from this account. Nothing is posted to a live Teams channel.
            </p>
            {(sharesQuery.data?.items ?? []).length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">No Teams shares yet.</p>
            ) : (
              <ul className="space-y-2">
                {(sharesQuery.data?.items ?? []).map((share) => (
                  <li key={share.id} className="rounded-[var(--radius-input)] border border-[var(--border)] px-3 py-2">
                    <p className="text-sm text-[var(--text-primary)]">
                      {share.articleCount} article{share.articleCount === 1 ? '' : 's'}
                      {share.simulated ? ' · simulated' : ''}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{formatDate(share.createdAt)}</p>
                    {share.message ? (
                      <p className="mt-1 line-clamp-2 text-sm text-[var(--text-secondary)]">{share.message}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}
    </PageBody>
  );
}
