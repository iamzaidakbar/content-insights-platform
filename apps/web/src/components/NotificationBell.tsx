import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';

import { useClickOutside } from '../hooks/useClickOutside';
import { formatDate } from '../lib/format';
import {
  fetchNotifications,
  fetchUnreadCount,
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

export default function NotificationBell() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, () => setIsOpen(false));

  const unreadQuery = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: fetchUnreadCount,
    refetchInterval: 30_000,
  });
  const unread = unreadQuery.data?.unread ?? 0;

  const listQuery = useQuery({
    queryKey: ['notifications-inbox'],
    queryFn: () => fetchNotifications(1, 10),
    enabled: isOpen,
  });

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-page'] });
    },
  });

  const markAllMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications-page'] });
    },
  });

  const items = listQuery.data?.items ?? [];

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        title="Notifications"
        aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
        onClick={() => setIsOpen((open) => !open)}
        className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-button)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      >
        <Bell size={18} strokeWidth={1.75} />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-semibold text-[var(--on-accent)]">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Notifications</h3>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => markAllMutation.mutate()}
                disabled={markAllMutation.isPending}
                className="text-xs text-[var(--accent)] hover:underline disabled:opacity-60"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {listQuery.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded bg-[var(--bg-hover)]" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-[var(--text-muted)]">No notifications yet.</p>
            ) : (
              <ul>
                {items.map((n) => {
                  const href = entityPath(n.entityType, n.entityId);
                  const content = (
                    <>
                      <p className={`text-sm ${n.read ? 'text-[var(--text-secondary)]' : 'font-medium text-[var(--text-primary)]'}`}>
                        {n.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-muted)]">{n.body}</p>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">{formatDate(n.createdAt)}</p>
                    </>
                  );
                  return (
                    <li key={n.id} className={`border-b border-[var(--border)] last:border-b-0 ${n.read ? '' : 'bg-[var(--accent-soft)]/40'}`}>
                      {href ? (
                        <Link
                          to={href}
                          onClick={() => {
                            if (!n.read) markReadMutation.mutate(n.id);
                            setIsOpen(false);
                          }}
                          className="block px-3 py-2.5 hover:bg-[var(--bg-hover)]"
                        >
                          {content}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (!n.read) markReadMutation.mutate(n.id);
                          }}
                          className="block w-full px-3 py-2.5 text-left hover:bg-[var(--bg-hover)]"
                        >
                          {content}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-[var(--border)] px-3 py-2">
            <Link
              to="/alerts"
              onClick={() => setIsOpen(false)}
              className="block text-center text-xs font-medium text-[var(--accent)] hover:underline"
            >
              View all notifications
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
