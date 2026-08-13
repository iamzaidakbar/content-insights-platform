import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../auth/AuthContext';
import { fetchChannels } from '../lib/channels-api';
import { fetchSavedSearches } from '../lib/saved-searches-api';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from './ui/command';

interface CommandItemModel {
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

  const items = useMemo<CommandItemModel[]>(() => {
    const base: CommandItemModel[] = [
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
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      title="Command palette"
      description="Jump to a page, saved search, or channel"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Jump to a page, saved search, or channel…"
      />
      <CommandList>
        <CommandEmpty>No matching destinations.</CommandEmpty>
        <CommandGroup>
          {items.map((item) => (
            <CommandItem key={item.id} value={`${item.label} ${item.hint ?? ''}`} onSelect={() => go(item.to)}>
              <span>{item.label}</span>
              {item.hint ? <CommandShortcut>{item.hint}</CommandShortcut> : null}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
