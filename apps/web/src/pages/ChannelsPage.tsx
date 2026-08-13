import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowDownAZ, ArrowUpAZ, Rss, Share2 } from 'lucide-react';

import type { SavedSearchType, SavedSearchWithViewerState } from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import EmptyState from '../components/EmptyState';
import Pagination from '../components/Pagination';
import { Alert, Badge, Button, Card, IconButton, PageBody, PageHeader, Select, Tabs } from '../components/ui';
import { getApiErrorMessage } from '../lib/api-client';
import { fetchChannels, type ChannelListSort } from '../lib/channels-api';
import { formatDate } from '../lib/format';
import { fetchGroups } from '../lib/groups-api';

const SKELETON_ROW_COUNT = 6;

const CHANNEL_TABS: { id: SavedSearchType; label: string }[] = [
  { id: 'dynamic', label: 'Dynamic' },
  { id: 'snapshot', label: 'Snapshot' },
];

const SORT_LABELS: Record<ChannelListSort, string> = {
  lastViewed_desc: 'Recently opened',
  lastViewed_asc: 'Oldest opened',
};

// Deep link shared from either this list or ChannelDetailPage — carries the channel id in
// the path (never a query param, so a plain visit to it is already the "clean" URL the open
// flow lands on) plus the sharer's current project/group as query params, so whoever opens
// it lands in the same context before ChannelDetailPage strips those params back off. See
// ChannelDetailPage's own comment on consuming them.
function buildChannelShareUrl(channelId: string, projectId: string | null, groupId: string | null): string {
  const url = new URL(`/channels/${channelId}`, window.location.origin);
  if (projectId) url.searchParams.set('projectId', projectId);
  if (groupId) url.searchParams.set('groupId', groupId);
  return url.toString();
}

async function copyChannelLink(channelId: string, projectId: string | null, groupId: string | null) {
  try {
    await navigator.clipboard.writeText(buildChannelShareUrl(channelId, projectId, groupId));
    toast.success('Channel link copied to clipboard.');
  } catch {
    toast.error('Unable to copy link.');
  }
}

export default function ChannelsPage() {
  const { user } = useAuth();
  const [type, setType] = useState<SavedSearchType>('dynamic');
  const [sort, setSort] = useState<ChannelListSort>('lastViewed_desc');
  const [groupFilter, setGroupFilter] = useState('');
  const [page, setPage] = useState(1);

  const groupsQuery = useQuery({ queryKey: ['groups-options'], queryFn: () => fetchGroups(1), staleTime: 5 * 60_000 });
  const groups = groupsQuery.data?.items ?? [];
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));

  const channelsQuery = useQuery({
    queryKey: ['channels', type, sort, groupFilter, page],
    queryFn: () => fetchChannels({ type, sort, page, ...(groupFilter ? { groupId: groupFilter } : {}) }),
  });
  const channels = channelsQuery.data?.items ?? [];
  const showEmptyState = !channelsQuery.isLoading && !channelsQuery.isError && channels.length === 0;

  function handleTabChange(next: SavedSearchType) {
    setType(next);
    setPage(1);
  }

  function toggleSort() {
    setSort((current) => (current === 'lastViewed_desc' ? 'lastViewed_asc' : 'lastViewed_desc'));
    setPage(1);
  }

  function displayName(channel: SavedSearchWithViewerState): string {
    return channel.channelName?.trim() || channel.name;
  }

  return (
    <PageBody>
      <PageHeader
        title="Channels"
        description="Saved searches exposed as channels across your groups. Promote one from Saved Searches."
        actions={
          groups.length > 0 ? (
            <Select
              value={groupFilter}
              onChange={(event) => {
                setGroupFilter(event.target.value);
                setPage(1);
              }}
              aria-label="Filter by group"
              className="h-9 w-auto min-w-[10rem] py-0"
            >
              <option value="">All groups</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs items={CHANNEL_TABS} value={type} onChange={handleTabChange} className="flex-1" />
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={toggleSort}
          leftIcon={sort === 'lastViewed_desc' ? <ArrowDownAZ size={14} /> : <ArrowUpAZ size={14} />}
        >
          {SORT_LABELS[sort]}
        </Button>
      </div>

      {channelsQuery.isError ? (
        <Alert variant="error" className="mb-4">
          {getApiErrorMessage(channelsQuery.error, 'Unable to load channels.')}
        </Alert>
      ) : null}

      <Card>
        <div className="overflow-x-auto px-4 py-2">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Group</th>
                <th className="pb-2 pr-4 font-medium">Last opened</th>
                <th className="pb-2 pr-4 font-medium"></th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {channelsQuery.isLoading
                ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                    <tr key={index} className="h-12 border-b border-[var(--border)]">
                      <td className="py-3 pr-4"><div className="h-4 w-44 animate-pulse rounded bg-[var(--bg-hover)]" /></td>
                      <td className="py-3 pr-4"><div className="h-4 w-24 animate-pulse rounded bg-[var(--bg-hover)]" /></td>
                      <td className="py-3 pr-4"><div className="h-4 w-28 animate-pulse rounded bg-[var(--bg-hover)]" /></td>
                      <td className="py-3 pr-4"><div className="h-4 w-8 animate-pulse rounded bg-[var(--bg-hover)]" /></td>
                      <td className="py-3"><div className="h-4 w-8 animate-pulse rounded bg-[var(--bg-hover)]" /></td>
                    </tr>
                  ))
                : channels.map((channel) => (
                    <tr key={channel.id} className="h-12 border-b border-[var(--border)] last:border-b-0">
                      <td className="py-3 pr-4 text-[var(--text-primary)]">
                        <Link to={`/channels/${channel.id}`} className="hover:text-[var(--accent)]">
                          {displayName(channel)}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-secondary)]">
                        {groupNameById.get(channel.groupId) ?? '—'}
                      </td>
                      <td className="py-3 pr-4 text-[var(--text-secondary)]">
                        {channel.viewerState.lastViewedAt ? formatDate(channel.viewerState.lastViewedAt) : 'Never'}
                      </td>
                      <td className="py-3 pr-4">
                        {channel.viewerState.hasNewArticles ? <Badge variant="accent">New</Badge> : null}
                      </td>
                      <td className="py-3">
                        <IconButton
                          icon={Share2}
                          label="Copy channel link"
                          size="sm"
                          onClick={() =>
                            void copyChannelLink(channel.id, user?.currentProjectId ?? null, user?.currentGroupId ?? null)
                          }
                        />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>

          {showEmptyState ? (
            <EmptyState
              icon={Rss}
              title={type === 'dynamic' ? 'No dynamic channels yet' : 'No snapshot channels yet'}
              description="Promote a saved search to a channel to see it here."
            />
          ) : null}
        </div>
      </Card>

      {channelsQuery.data && channelsQuery.data.totalPages > 1 ? (
        <div className="mt-4 flex justify-end">
          <Pagination page={page} totalPages={channelsQuery.data.totalPages} onPageChange={setPage} />
        </div>
      ) : null}
    </PageBody>
  );
}
