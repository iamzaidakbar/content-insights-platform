import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Bookmark, RadioTower, Share2, X } from 'lucide-react';

import {
  SAVED_SEARCH_TYPES,
  type FilterPanelState,
  type SavedSearch,
  type SavedSearchType,
} from '@content-insights/shared';

import EmptyState from './EmptyState';
import Pagination from './Pagination';
import { getApiErrorMessage } from '../lib/api-client';
import { formatDate } from '../lib/format';
import {
  createSavedSearch,
  deleteSavedSearch,
  demoteSavedSearchChannel,
  exportSavedSearchQuery,
  exposeSavedSearchChannel,
  fetchSavedSearch,
  fetchSavedSearches,
  revokeSavedSearchShare,
  shareSavedSearch,
  updateSavedSearch,
  type LoadSavedSearchResult,
} from '../lib/saved-searches-api';
import { fetchGroups } from '../lib/groups-api';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import { Input, Select } from './ui/Input';
import Modal from './ui/Modal';

// ---------------------------------------------------------------------------------------
// A single reusable surface for saved-search management, used two ways:
//  - `SavedQueriesModal` (default export) — the dialog opened from the Articles header's
//    Save/Load buttons.
//  - `SavedQueriesPanel` (named export) — the same content, unwrapped, embedded directly by
//    SavedSearchesPage as its full-page body. Nothing here duplicates SavedSearchesPage's
//    old bespoke table; that page now just renders this panel.
// The "Save current search" tab only appears when a caller supplies `currentFilters` (the
// Articles page has an active search to save; the standalone /saved-searches route does
// not), matching the API's own `filters` field name exactly (packages/shared's
// createSavedSearchSchema) rather than the pre-pivot `params` shape.
// ---------------------------------------------------------------------------------------

const SKELETON_ROW_COUNT = 5;

function describeFilters(filters: FilterPanelState): string {
  const parts: string[] = [];
  const trimmedQuery = filters.query.trim();
  if (trimmedQuery) parts.push(`"${trimmedQuery}"`);
  if (filters.sourceTypeTab !== 'all') parts.push(filters.sourceTypeTab === 'news' ? 'News only' : 'Documents only');
  if (filters.dateFilter) parts.push('date range');
  // `?? {}`: Mongoose's default `minimize` strips a genuinely-empty taxonomyValues: {} at
  // write time, so an older saved search saved with no taxonomy selections at all (e.g. the
  // seeded "Reputation Risk Alerts") can come back from the API with this key missing
  // entirely rather than `{}` — without the fallback this throws ("Cannot convert undefined
  // or null to object") and takes down the whole Saved Searches list via the ErrorBoundary.
  const taxonomyValueCount = Object.values(filters.taxonomyValues ?? {}).reduce(
    (sum, values) => sum + values.length,
    0,
  );
  if (taxonomyValueCount > 0) {
    parts.push(`${taxonomyValueCount} taxonomy value${taxonomyValueCount === 1 ? '' : 's'}`);
  }
  if (filters.userTagIds.length > 0) {
    parts.push(`${filters.userTagIds.length} tag${filters.userTagIds.length === 1 ? '' : 's'}`);
  }
  if (filters.advancedSearch.enabled && filters.advancedSearch.groups.length > 0) {
    parts.push('advanced search');
  }
  return parts.length > 0 ? parts.join(' · ') : 'All articles';
}

// ---------------------------------------------------------------------------------------
// Per-row action modals — shared Modal / ConfirmDialog chrome (z-50 nested overlays stack
// above SavedQueriesModal when this panel is used inside it).
// ---------------------------------------------------------------------------------------

function RenameDialog({
  search,
  onClose,
  onRenamed,
}: {
  search: SavedSearch;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(search.name);
  const [error, setError] = useState<string | null>(null);

  const renameMutation = useMutation({
    mutationFn: () => updateSavedSearch(search.id, { name: name.trim() }),
    onSuccess: () => {
      onRenamed();
      toast.success('Renamed.');
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to rename.')),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    renameMutation.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Rename saved search"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="rename-saved-search-form" loading={renameMutation.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="rename-saved-search-form" onSubmit={handleSubmit} className="space-y-3">
        <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}
      </form>
    </Modal>
  );
}

function ShareDialog({
  search,
  groupOptions,
  onClose,
  onShared,
}: {
  search: SavedSearch;
  groupOptions: { id: string; name: string }[];
  onClose: () => void;
  onShared: () => void;
}) {
  const alreadySharedIds = new Set(search.sharedWithGroups.map((grant) => grant.groupId as string));
  const selectable = groupOptions.filter((group) => group.id !== search.groupId && !alreadySharedIds.has(group.id));
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const shareMutation = useMutation({
    mutationFn: () => shareSavedSearch(search.id, selected),
    onSuccess: () => {
      onShared();
      toast.success('Shared.');
      setSelected([]);
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to share this search.')),
  });

  const revokeMutation = useMutation({
    mutationFn: (groupId: string) => revokeSavedSearchShare(search.id, groupId),
    onSuccess: () => {
      onShared();
      toast.success('Removed.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to remove this share.')),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Share "${search.name}"`}
      size="md"
      testId="saved-search-share-dialog"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() => shareMutation.mutate()}
            disabled={selected.length === 0}
            loading={shareMutation.isPending}
          >
            Share
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-xs font-medium text-[var(--text-secondary)]">Currently shared with</p>
          {search.sharedWithGroups.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--text-muted)]">Not shared into any other groups yet.</p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {search.sharedWithGroups.map((grant) => (
                <span
                  key={grant.groupId}
                  className="flex items-center gap-1 rounded-[var(--radius-tag)] px-2 py-1 text-xs font-medium"
                  style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
                >
                  {grant.groupName}
                  <button
                    type="button"
                    onClick={() => revokeMutation.mutate(grant.groupId)}
                    disabled={revokeMutation.isPending}
                    aria-label={`Stop sharing with ${grant.groupName}`}
                    className="hover:text-[var(--red)]"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-[var(--text-secondary)]">Share with more groups</p>
          {selectable.length === 0 ? (
            <p className="mt-1 text-sm text-[var(--text-muted)]">No other groups available.</p>
          ) : (
            <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto rounded-[var(--radius-input)] border border-[var(--border)] p-2">
              {selectable.map((group) => (
                <label key={group.id} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={selected.includes(group.id)}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(group.id) ? current.filter((id) => id !== group.id) : [...current, group.id],
                      )
                    }
                    className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                  />
                  {group.name}
                </label>
              ))}
            </div>
          )}
        </div>

        {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}
      </div>
    </Modal>
  );
}

// "Optional" per the brief: pre-filled with the search's own name, editable, and falls back
// to it automatically if left blank — the server's setChannelSchema still requires a
// non-empty channelName whenever isChannel: true, so a truly empty value is never sent.
function ExposeChannelDialog({
  search,
  onClose,
  onExposed,
}: {
  search: SavedSearch;
  onClose: () => void;
  onExposed: () => void;
}) {
  const [channelName, setChannelName] = useState(search.channelName ?? search.name);
  const [error, setError] = useState<string | null>(null);

  const exposeMutation = useMutation({
    mutationFn: () => exposeSavedSearchChannel(search.id, channelName.trim() || search.name),
    onSuccess: () => {
      onExposed();
      toast.success('Now available as a channel.');
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to expose this search as a channel.')),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Expose as a channel"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => exposeMutation.mutate()} loading={exposeMutation.isPending}>
            Expose as channel
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm font-medium text-[var(--text-secondary)]">
          Channel name <span className="text-[var(--text-muted)]">(optional — defaults to this search's name)</span>
          <Input
            value={channelName}
            onChange={(event) => setChannelName(event.target.value)}
            placeholder={search.name}
            className="mt-1"
          />
        </label>
        {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}
      </div>
    </Modal>
  );
}

function ExportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const exportQuery = useQuery({ queryKey: ['saved-search-export', id], queryFn: () => exportSavedSearchQuery(id) });
  const json = exportQuery.data ? JSON.stringify(exportQuery.data, null, 2) : '';

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(json);
      toast.success('Copied to clipboard.');
    } catch {
      toast.error('Unable to copy.');
    }
  }

  function handleDownload() {
    if (!exportQuery.data) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exportQuery.data.name.replace(/[^a-z0-9-_]+/gi, '_')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Export query definition"
      size="lg"
      footer={
        exportQuery.isLoading || exportQuery.isError ? undefined : (
          <>
            <Button variant="outline" onClick={() => void handleCopy()}>
              Copy
            </Button>
            <Button onClick={handleDownload}>Download</Button>
          </>
        )
      }
    >
      {exportQuery.isLoading ? (
        <p className="text-sm text-[var(--text-secondary)]">Loading…</p>
      ) : exportQuery.isError ? (
        <p className="text-sm text-[var(--red)]">{getApiErrorMessage(exportQuery.error, 'Unable to export this search.')}</p>
      ) : (
        <pre className="max-h-72 overflow-auto rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)]">
          {json}
        </pre>
      )}
    </Modal>
  );
}

function DeleteConfirmDialog({
  search,
  onClose,
  onDeleted,
}: {
  search: SavedSearch;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  // A protected default query is rejected with 409 SAVED_SEARCH_IS_DEFAULT — the server's
  // own message ("Default group query cannot be deleted while it remains the default") is
  // surfaced here verbatim, not reworded.
  const deleteMutation = useMutation({
    mutationFn: () => deleteSavedSearch(search.id),
    onSuccess: () => {
      onDeleted();
      toast.success('Deleted.');
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to delete this saved search.')),
  });

  const baseDescription = `"${search.name}" will stop appearing in Saved Searches${search.isChannel ? ' and Channels' : ''}. This cannot be undone from the UI.`;

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => deleteMutation.mutate()}
      title="Delete saved search?"
      description={error ? `${baseDescription} ${error}` : baseDescription}
      confirmLabel="Delete"
      destructive
      loading={deleteMutation.isPending}
      testId="delete-saved-search-dialog"
      confirmTestId="confirm-delete-saved-search"
    />
  );
}

function SaveCurrentSearchTab({
  filters,
  groupOptions,
  defaultGroupId,
  onSaved,
}: {
  filters: FilterPanelState;
  groupOptions: { id: string; name: string }[];
  defaultGroupId: string | undefined;
  onSaved: (search: SavedSearch) => void;
}) {
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(defaultGroupId ?? groupOptions[0]?.id ?? '');
  const [type, setType] = useState<SavedSearchType>('dynamic');
  const [error, setError] = useState<string | null>(null);

  // A 409 name conflict (global uniqueness) and a snapshot's 400 cap/missing-locationHash
  // rejections all land here as `error`, using the server's message as-is — see
  // savedSearch.service.ts's assertNameAvailable / assertSnapshotWithinLimits for exactly
  // what those messages say.
  const saveMutation = useMutation({
    mutationFn: () => createSavedSearch({ groupId, name: name.trim(), type, filters }),
    onSuccess: (created) => {
      onSaved(created);
      toast.success(`Saved "${created.name}".`);
      setName('');
    },
    onError: (err) => setError(getApiErrorMessage(err, 'Unable to save this search.')),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!groupId) {
      setError('Select a group.');
      return;
    }
    saveMutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        Saving: <span className="text-[var(--text-primary)]">{describeFilters(filters)}</span>
      </p>

      <div>
        <label htmlFor="save-query-name" className="block text-sm font-medium text-[var(--text-secondary)]">
          Name
        </label>
        <Input
          id="save-query-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1"
        />
      </div>

      <div>
        <label htmlFor="save-query-group" className="block text-sm font-medium text-[var(--text-secondary)]">
          Group
        </label>
        <Select
          id="save-query-group"
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
          className="mt-1"
        >
          {groupOptions.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <span className="block text-sm font-medium text-[var(--text-secondary)]">Type</span>
        <div className="mt-1.5 space-y-1.5">
          {SAVED_SEARCH_TYPES.map((option) => (
            <label key={option} className="flex cursor-pointer items-start gap-2 text-sm text-[var(--text-secondary)]">
              <input
                type="radio"
                name="save-query-type"
                checked={type === option}
                onChange={() => setType(option)}
                className="mt-0.5 h-4 w-4 border-[var(--border)] accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium text-[var(--text-primary)]">{option === 'dynamic' ? 'Dynamic' : 'Snapshot'}</span>
                {' — '}
                {option === 'dynamic'
                  ? 're-runs live every time it is opened.'
                  : "freezes today's matching articles; blocked if the result set is too large or missing location data."}
              </span>
            </label>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}

      <Button type="submit" disabled={groupOptions.length === 0} loading={saveMutation.isPending} className="w-full">
        Save search
      </Button>
    </form>
  );
}

// -----------------------------------------------------------------------------------------
// SavedQueriesPanel — the reusable content, embeddable either inside SavedQueriesModal's
// dialog chrome or directly inside a page.
// -----------------------------------------------------------------------------------------

export interface SavedQueriesPanelProps {
  /** Present only where there's an active search to save (e.g. the Articles page). */
  currentFilters?: FilterPanelState;
  /** The caller's current navbar group — widens visibility (its default/shared-into) and pre-selects the Save group. */
  currentGroupId?: string;
  onLoad?: (loaded: LoadSavedSearchResult) => void;
  /** Closes the surrounding modal after a successful Load — no-op when embedded in a page. */
  onClose?: () => void;
  initialTab?: 'browse' | 'save';
}

export function SavedQueriesPanel({
  currentFilters,
  currentGroupId,
  onLoad,
  onClose,
  initialTab = 'browse',
}: SavedQueriesPanelProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'browse' | 'save'>(currentFilters ? initialTab : 'browse');
  const [page, setPage] = useState(1);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const [renaming, setRenaming] = useState<SavedSearch | null>(null);
  const [sharing, setSharing] = useState<SavedSearch | null>(null);
  const [exposing, setExposing] = useState<SavedSearch | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SavedSearch | null>(null);

  const groupsQuery = useQuery({ queryKey: ['groups-options'], queryFn: () => fetchGroups(), staleTime: 5 * 60_000 });
  const groupOptions = (groupsQuery.data?.items ?? []).map((group) => ({ id: group.id as string, name: group.name }));
  const groupNameById = new Map(groupOptions.map((group) => [group.id, group.name]));

  // scope: 'mine' is the API's full visibility resolution (own + admin tiers + current
  // group's default/shared), not literally "owned by me" — see saved-searches-api.ts's own
  // comment. Passing currentGroupId widens it to that group's default query and anything
  // explicitly shared into it.
  const listQuery = useQuery({
    queryKey: ['saved-searches', 'mine', currentGroupId ?? null, page],
    queryFn: () => fetchSavedSearches('mine', currentGroupId, page),
  });
  const searches = listQuery.data?.items ?? [];
  const showEmptyState = !listQuery.isLoading && !listQuery.isError && searches.length === 0;

  function invalidateList() {
    void queryClient.invalidateQueries({ queryKey: ['saved-searches'] });
  }

  const demoteMutation = useMutation({
    mutationFn: (id: string) => demoteSavedSearchChannel(id),
    onSuccess: () => {
      invalidateList();
      toast.success('Removed from channels.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to demote this channel.')),
  });

  async function handleLoad(search: SavedSearch) {
    setLoadingId(search.id);
    try {
      const loaded = await fetchSavedSearch(search.id);
      onLoad?.(loaded);
      toast.success(`Loaded "${loaded.savedSearch.name}".`);
      onClose?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Unable to load this saved search.'));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div>
      {currentFilters ? (
        <div className="mb-4 flex gap-1 rounded-[var(--radius-button)] border border-[var(--border)] p-1">
          <button
            type="button"
            onClick={() => setTab('browse')}
            className={`flex-1 rounded-[calc(var(--radius-button)-2px)] py-1.5 text-sm font-medium transition-colors ${
              tab === 'browse' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            Load
          </button>
          <button
            type="button"
            onClick={() => setTab('save')}
            className={`flex-1 rounded-[calc(var(--radius-button)-2px)] py-1.5 text-sm font-medium transition-colors ${
              tab === 'save' ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            Save current search
          </button>
        </div>
      ) : null}

      {tab === 'save' && currentFilters ? (
        <SaveCurrentSearchTab
          filters={currentFilters}
          groupOptions={groupOptions}
          defaultGroupId={currentGroupId}
          onSaved={() => {
            invalidateList();
            setTab('browse');
          }}
        />
      ) : (
        <div>
          {listQuery.isError ? (
            <p className="mb-3 text-sm text-[var(--red)]">{getApiErrorMessage(listQuery.error, 'Unable to load saved searches.')}</p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-secondary)]">
                  <th className="pb-2 pr-4 font-medium">Name</th>
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Summary</th>
                  <th className="pb-2 pr-4 font-medium">Last run</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading
                  ? Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                      <tr key={index} className="h-12 border-b border-[var(--border)]">
                        <td className="py-3 pr-4">
                          <div className="h-4 w-32 animate-pulse rounded bg-[var(--bg-hover)]" />
                        </td>
                        <td className="py-3 pr-4">
                          <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-hover)]" />
                        </td>
                        <td className="py-3 pr-4">
                          <div className="h-4 w-40 animate-pulse rounded bg-[var(--bg-hover)]" />
                        </td>
                        <td className="py-3 pr-4">
                          <div className="h-4 w-20 animate-pulse rounded bg-[var(--bg-hover)]" />
                        </td>
                        <td className="py-3">
                          <div className="h-4 w-24 animate-pulse rounded bg-[var(--bg-hover)]" />
                        </td>
                      </tr>
                    ))
                  : searches.map((search) => (
                      <tr key={search.id} className="border-b border-[var(--border)] align-top">
                        <td className="py-3 pr-4 text-[var(--text-primary)]">
                          <div className="flex items-center gap-1.5">
                            {search.isChannel ? (
                              <span title={`Channel: ${search.channelName ?? search.name}`}>
                                <RadioTower size={13} className="shrink-0 text-[var(--accent)]" />
                              </span>
                            ) : null}
                            {search.sharedWithGroups.length > 0 ? (
                              <span title={`Shared with ${search.sharedWithGroups.length} other group(s)`}>
                                <Share2 size={12} className="shrink-0 text-[var(--text-muted)]" />
                              </span>
                            ) : null}
                            <span className="font-medium">{search.name}</span>
                          </div>
                          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                            {groupNameById.get(search.groupId) ?? 'Unknown group'} · {search.ownerEmail}
                          </p>
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className="rounded-[var(--radius-tag)] px-2 py-0.5 text-xs font-medium"
                            style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
                          >
                            {search.type === 'dynamic' ? 'Dynamic' : 'Snapshot'}
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-[var(--text-secondary)]">{describeFilters(search.filters)}</td>
                        <td className="py-3 pr-4 text-[var(--text-secondary)]">
                          {search.lastRunAt ? formatDate(search.lastRunAt) : 'Never'}
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                            <button
                              type="button"
                              onClick={() => void handleLoad(search)}
                              disabled={loadingId === search.id}
                              className="font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {loadingId === search.id ? 'Loading…' : 'Load'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenaming(search)}
                              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => setSharing(search)}
                              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              Share
                            </button>
                            {search.isChannel ? (
                              <button
                                type="button"
                                onClick={() => demoteMutation.mutate(search.id)}
                                disabled={demoteMutation.isPending}
                                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Demote
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setExposing(search)}
                                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                              >
                                Expose
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setExportingId(search.id)}
                              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              Export
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleting(search)}
                              className="text-[var(--red)] hover:underline"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>

            {showEmptyState ? (
              <EmptyState
                icon={Bookmark}
                title="No saved searches yet"
                description="Save a search from Articles to find it here."
              />
            ) : null}
          </div>

          {listQuery.data && listQuery.data.totalPages > 1 ? (
            <div className="mt-4 flex justify-end">
              <Pagination page={page} totalPages={listQuery.data.totalPages} onPageChange={setPage} />
            </div>
          ) : null}
        </div>
      )}

      {renaming ? (
        <RenameDialog search={renaming} onClose={() => setRenaming(null)} onRenamed={invalidateList} />
      ) : null}
      {sharing ? (
        <ShareDialog search={sharing} groupOptions={groupOptions} onClose={() => setSharing(null)} onShared={invalidateList} />
      ) : null}
      {exposing ? (
        <ExposeChannelDialog search={exposing} onClose={() => setExposing(null)} onExposed={invalidateList} />
      ) : null}
      {exportingId ? <ExportDialog id={exportingId} onClose={() => setExportingId(null)} /> : null}
      {deleting ? (
        <DeleteConfirmDialog search={deleting} onClose={() => setDeleting(null)} onDeleted={invalidateList} />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------------------
// SavedQueriesModal — the dialog wrapper opened from the Articles header's Save/Load buttons.
// -----------------------------------------------------------------------------------------

export interface SavedQueriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentFilters?: FilterPanelState;
  currentGroupId?: string;
  onLoad?: (loaded: LoadSavedSearchResult) => void;
  initialTab?: 'browse' | 'save';
}

export default function SavedQueriesModal({
  isOpen,
  onClose,
  currentFilters,
  currentGroupId,
  onLoad,
  initialTab,
}: SavedQueriesModalProps) {
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Saved Searches"
      size="full"
      scrollable
      className="max-w-[880px]"
    >
      <SavedQueriesPanel
        onClose={onClose}
        {...(currentFilters !== undefined ? { currentFilters } : {})}
        {...(currentGroupId !== undefined ? { currentGroupId } : {})}
        {...(onLoad !== undefined ? { onLoad } : {})}
        {...(initialTab !== undefined ? { initialTab } : {})}
      />
    </Modal>
  );
}
