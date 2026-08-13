import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';

import { useAuth } from '../auth/AuthContext';
import { fetchChannels } from '../lib/channels-api';
import { fetchSavedSearches } from '../lib/saved-searches-api';

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  to: string;
}

export default function CommandPalette() {
  const { permissions } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const isAppAdmin = permissions.includes('*');
  const canAdmin =
    isAppAdmin ||
    ['org:admin', 'users:read', 'roles:read', 'entity-mapping:read', 'audit:read'].some((key) =>
      permissions.includes(key),
    );

  const savedQuery = useQuery({
    queryKey: ['palette-saved-searches'],
    queryFn: () => fetchSavedSearches('mine', undefined, 1),
    enabled: open,
    staleTime: 30_000,
  });
  const channelsQuery = useQuery({
    queryKey: ['palette-channels'],
    queryFn: () => fetchChannels({ page: 1 }),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const items = useMemo<CommandItem[]>(() => {
    const base: CommandItem[] = [
      { id: 'articles', label: 'Articles', to: '/articles' },
      { id: 'channels', label: 'Channels', to: '/channels' },
      { id: 'saved', label: 'Saved Searches', to: '/saved-searches' },
      { id: 'insights', label: 'Insights', to: '/insights' },
      { id: 'dashboards', label: 'Dashboards', to: '/dashboards' },
      { id: 'profile', label: 'Profile', to: '/profile' },
    ];
    if (canAdmin) {
      base.push(
        { id: 'admin-users', label: 'Admin · Users', to: '/admin/users' },
        { id: 'admin-audit', label: 'Admin · Audit', to: '/admin/audit' },
      );
    }
    for (const search of savedQuery.data?.items ?? []) {
      base.push({
        id: `ss-${search.id}`,
        label: search.name,
        hint: 'Saved search',
        to: `/articles?savedSearch=${search.id}`,
      });
    }
    for (const channel of channelsQuery.data?.items ?? []) {
      base.push({
        id: `ch-${channel.id}`,
        label: channel.channelName ?? channel.name,
        hint: 'Channel',
        to: `/channels/${channel.id}`,
      });
    }
    const needle = query.trim().toLowerCase();
    if (!needle) return base;
    return base.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) || (item.hint?.toLowerCase().includes(needle) ?? false),
    );
  }, [canAdmin, channelsQuery.data, query, savedQuery.data]);

  function go(to: string) {
    setOpen(false);
    setQuery('');
    navigate(to);
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-[20%] z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] outline-none">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a page, saved search, or channel…"
            className="w-full border-b border-[var(--border)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <ul className="max-h-72 overflow-y-auto p-1">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => go(item.to)}
                  className="flex w-full items-center justify-between rounded-[var(--radius-button)] px-3 py-2 text-left text-sm hover:bg-[var(--bg-hover)]"
                >
                  <span className="text-[var(--text-primary)]">{item.label}</span>
                  {item.hint ? <span className="text-xs text-[var(--text-muted)]">{item.hint}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
