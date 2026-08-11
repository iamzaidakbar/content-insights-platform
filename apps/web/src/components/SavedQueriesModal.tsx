import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
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
import { INPUT_CLASSNAME } from '../lib/form-styles';
import { fetchGroups } from '../lib/groups-api';
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
// Dialog — shared chrome for the per-row action modals below. Renders above
// SavedQueriesModal's own overlay (z-50) whenever this panel is used inside it.
// ---------------------------------------------------------------------------------------

function Dialog({
  title,
  onClose,
  children,
  widthClassName = 'max-w-sm',
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
  testId?: string;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        data-testid={testId}
        className={`w-full ${widthClassName} rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] p-6`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-[6px] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

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
    <Dialog title="Rename saved search" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className={INPUT_CLASSNAME} />
        {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={renameMutation.isPending}
            className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {renameMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
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
    <Dialog title={`Share "${search.name}"`} onClose={onClose} widthClassName="max-w-md" testId="saved-search-share-dialog">
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

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => shareMutation.mutate()}
            disabled={selected.length === 0 || shareMutation.isPending}
            className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {shareMutation.isPending ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </div>
    </Dialog>
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
    <Dialog title="Expose as a channel" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm font-medium text-[var(--text-secondary)]">
          Channel name <span className="text-[var(--text-muted)]">(optional — defaults to this search's name)</span>
          <input
            value={channelName}
            onChange={(event) => setChannelName(event.target.value)}
            placeholder={search.name}
            className={`mt-1 ${INPUT_CLASSNAME}`}
          />
        </label>
        {error ? <p className="text-sm text-[var(--red)]">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => exposeMutation.mutate()}
            disabled={exposeMutation.isPending}
            className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exposeMutation.isPending ? 'Saving…' : 'Expose as channel'}
          </button>
        </div>
      </div>
    </Dialog>
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
    <Dialog title="Export query definition" onClose={onClose} widthClassName="max-w-lg">
      {exportQuery.isLoading ? (
        <p className="text-sm text-[var(--text-secondary)]">Loading…</p>
      ) : exportQuery.isError ? (
        <p className="text-sm text-[var(--red)]">{getApiErrorMessage(exportQuery.error, 'Unable to export this search.')}</p>
      ) : (
        <>
          <pre className="max-h-72 overflow-auto rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)]">
            {json}
          </pre>
          <div className="mt-3 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="rounded-[var(--radius-button)] bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              Download
            </button>
          </div>
        </>
      )}
    </Dialog>
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

  return (
    <Dialog title="Delete saved search?" onClose={onClose} testId="delete-saved-search-dialog">
      <p className="text-sm text-[var(--text-secondary)]">
        &quot;{search.name}&quot; will stop appearing in Saved Searches{search.isChannel ? ' and Channels' : ''}. This
        cannot be undone from the UI.
      </p>
      {error ? <p className="mt-3 text-sm text-[var(--red)]">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[var(--radius-button)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="confirm-delete-saved-search"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          className="rounded-[var(--radius-button)] bg-[var(--red)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </Dialog>
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
        <input
          id="save-query-name"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={`mt-1 ${INPUT_CLASSNAME}`}
        />
      </div>

      <div>
        <label htmlFor="save-query-group" className="block text-sm font-medium text-[var(--text-secondary)]">
          Group
        </label>
        <select
          id="save-query-group"
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
          className={`mt-1 ${INPUT_CLASSNAME}`}
        >
          {groupOptions.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
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

      <button
        type="submit"
        disabled={saveMutation.isPending || groupOptions.length === 0}
        className="h-9 w-full rounded-[var(--radius-button)] bg-[var(--accent)] text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saveMutation.isPending ? 'Saving…' : 'Save search'}
      </button>
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

      {renaming ? <RenameDialog search={renaming} onClose={() => setRenaming(null)} onRenamed={invalidateList} /> : null}
      {sharing ? (
        <ShareDialog search={sharing} groupOptions={groupOptions} onClose={() => setSharing(null)} onShared={invalidateList} />
      ) : null}
      {exposing ? (
        <ExposeChannelDialog search={exposing} onClose={() => setExposing(null)} onExposed={invalidateList} />
      ) : null}
      {exportingId ? <ExportDialog id={exportingId} onClose={() => setExportingId(null)} /> : null}
      {deleting ? <DeleteConfirmDialog search={deleting} onClose={() => setDeleting(null)} onDeleted={invalidateList} /> : null}
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
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 py-10"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[880px] rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Saved Searches</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close saved searches"
            className="rounded-[6px] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
          <SavedQueriesPanel
            onClose={onClose}
            {...(currentFilters !== undefined ? { currentFilters } : {})}
            {...(currentGroupId !== undefined ? { currentGroupId } : {})}
            {...(onLoad !== undefined ? { onLoad } : {})}
            {...(initialTab !== undefined ? { initialTab } : {})}
          />
        </div>
      </div>
    </div>
  );
}
