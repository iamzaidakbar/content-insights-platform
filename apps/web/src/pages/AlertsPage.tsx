import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';

import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
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
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Notifications</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            New articles, channel updates, and permission changes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => {
                setUnreadOnly(e.target.checked);
                setPage(1);
              }}
              className="accent-[var(--accent)]"
            />
            Unread only
          </label>
          <button
            type="button"
            onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
            className="text-sm text-[var(--accent)] hover:underline disabled:opacity-60"
          >
            Mark all read
          </button>
        </div>
      </div>

      <div className="mt-6">
        {listQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-[var(--radius-card)] bg-[var(--bg-hover)]" />
            ))}
          </div>
        ) : listQuery.isError ? (
          <p className="text-sm text-[var(--red)]">
            {getApiErrorMessage(listQuery.error, 'Unable to load notifications.')}
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No notifications"
            description={unreadOnly ? 'You are all caught up.' : 'Activity will show up here.'}
          />
        ) : (
          <>
            <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-card)] border border-[var(--border)]">
              {items.map((n) => {
                const href = entityPath(n.entityType, n.entityId);
                return (
                  <li key={n.id} className={`px-4 py-3 ${n.read ? '' : 'bg-[var(--accent-soft)]/30'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        {href ? (
                          <Link
                            to={href}
                            onClick={() => {
                              if (!n.read) markReadMutation.mutate(n.id);
                            }}
                            className={`text-sm hover:text-[var(--accent)] ${n.read ? 'text-[var(--text-secondary)]' : 'font-medium text-[var(--text-primary)]'}`}
                          >
                            {n.title}
                          </Link>
                        ) : (
                          <p
                            className={`text-sm ${n.read ? 'text-[var(--text-secondary)]' : 'font-medium text-[var(--text-primary)]'}`}
                          >
                            {n.title}
                          </p>
                        )}
                        <p className="mt-1 text-sm text-[var(--text-muted)]">{n.body}</p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">{formatDate(n.createdAt)}</p>
                      </div>
                      {!n.read ? (
                        <button
                          type="button"
                          onClick={() => markReadMutation.mutate(n.id)}
                          className="shrink-0 text-xs text-[var(--accent)] hover:underline"
                        >
                          Mark read
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex justify-end">
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
