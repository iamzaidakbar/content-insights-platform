import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, Check } from 'lucide-react';

import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import { Alert, Button, Card, Checkbox, PageBody, PageHeader, Skeleton } from '../components/ui';
import { ActionIconButton } from '../components/ui/action-icon-button';
import { getApiErrorMessage } from '../lib/api-client';
import { formatDate } from '../lib/format';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../lib/notifications-api';

// Matches Notification['entityType'] (packages/shared/src/types/notification.ts) exactly —
// the pre-pivot 'document'/'incident' cases here no longer exist on that union at all.
function entityPath(entityType?: string, entityId?: string): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case 'article':
      return `/articles/${entityId}`;
    case 'group':
      return `/groups/${entityId}`;
    case 'savedSearch':
      return `/channels/${entityId}`;
    default:
      return null;
  }
}

export default function AlertsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const listQuery = useQuery({
    queryKey: ['notifications-page', page, unreadOnly],
    queryFn: () => fetchNotifications(page, 20, unreadOnly),
  });

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications-page'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-inbox'] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications-page'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-inbox'] });
    },
  });

  const items = listQuery.data?.items ?? [];
  const totalPages = listQuery.data?.totalPages ?? 1;

  return (
    <PageBody>
      <PageHeader
        title="Notifications"
        description="New articles, channel updates, and permission changes."
        actions={
          <div className="flex items-center gap-3">
            <Checkbox
              checked={unreadOnly}
              onChange={(e) => {
                setUnreadOnly(e.target.checked);
                setPage(1);
              }}
              label="Unread only"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => markAllMutation.mutate()}
              disabled={markAllMutation.isPending}
              className="text-primary hover:text-primary"
            >
              Mark all read
            </Button>
          </div>
        }
      />

      <div>
        {listQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : listQuery.isError ? (
          <Alert variant="error">
            {getApiErrorMessage(listQuery.error, 'Unable to load notifications.')}
          </Alert>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No notifications"
            description={unreadOnly ? 'You are all caught up.' : 'Activity will show up here.'}
          />
        ) : (
          <>
            <Card>
              <ul className="divide-y divide-border">
                {items.map((n) => {
                  const href = entityPath(n.entityType, n.entityId);
                  return (
                    <li key={n.id} className={`px-4 py-3 ${n.read ? '' : 'bg-accent/30'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {href ? (
                            <Link
                              to={href}
                              onClick={() => {
                                if (!n.read) markReadMutation.mutate(n.id);
                              }}
                              className={`text-sm hover:text-primary ${n.read ? 'text-muted-foreground' : 'font-medium text-foreground'}`}
                            >
                              {n.title}
                            </Link>
                          ) : (
                            <p
                              className={`text-sm ${n.read ? 'text-muted-foreground' : 'font-medium text-foreground'}`}
                            >
                              {n.title}
                            </p>
                          )}
                          <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{formatDate(n.createdAt)}</p>
                        </div>
                        {!n.read ? (
                          <ActionIconButton
                            label="Mark read"
                            icon={Check}
                            onClick={() => markReadMutation.mutate(n.id)}
                          />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <div className="mt-4 flex justify-end">
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </>
        )}
      </div>
    </PageBody>
  );
}
