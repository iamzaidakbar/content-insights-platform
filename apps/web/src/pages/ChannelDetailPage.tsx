import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, Grid2x2, Grid3x3, List, Share2 } from 'lucide-react';

import {
  DEFAULT_USER_SETTINGS,
  type Article,
  type ResultViewMode,
  type SearchHit,
  type UserTag,
} from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import AccessDeniedState from '../components/AccessDeniedState';
import ArticlesGrid from '../components/ArticlesGrid';
import Alert from '../components/ui/Alert';
import Badge from '../components/ui/Badge';
import Breadcrumbs from '../components/ui/Breadcrumbs';
import Button from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import PageHeader, { PageBody } from '../components/ui/PageHeader';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/DropdownMenu';
import { getApiErrorMessage } from '../lib/api-client';
import { exportArticles, hideArticle, unhideArticle } from '../lib/articles-api';
import { ChannelAccessError, fetchChannel, openChannel } from '../lib/channels-api';
import { fetchConcepts } from '../lib/concepts-api';
import { fetchGroups } from '../lib/groups-api';
import { runSavedSearch } from '../lib/saved-searches-api';
import { fetchMySettings, updateMySettings } from '../lib/settings-api';
import { bulkApplyUserTag, fetchUserTags } from '../lib/user-tags-api';
import { setCurrentGroup, setCurrentProject } from '../lib/users-api';
import { VIEW_MODE_PAGE_SIZE } from '../lib/article-layout';

interface ViewModeOption {
  value: ResultViewMode;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
}
const VIEW_MODE_OPTIONS: ViewModeOption[] = [
  { value: 'list', icon: List, label: 'List view' },
  { value: 'grid2x2', icon: Grid2x2, label: 'Grid 2×2' },
  { value: 'grid3x4', icon: Grid3x3, label: 'Grid 3×4' },
];

// Same deep-link shape ChannelsPage's row-level Share button builds — duplicated here
// rather than shared to keep these two pages independently ownable; keep in sync if the
// shape ever changes.
function buildChannelShareUrl(channelId: string, projectId: string | null, groupId: string | null): string {
  const url = new URL(`/channels/${channelId}`, window.location.origin);
  if (projectId) url.searchParams.set('projectId', projectId);
  if (groupId) url.searchParams.set('groupId', groupId);
  return url.toString();
}

// POST /saved-searches/:id/run (below) returns plain Article[] for both dynamic and snapshot
// channels alike — this converts one into the SearchHit shape ArticlesGrid renders. `score`/
// `highlight` have no equivalent here (there's no live free-text query to score or highlight
// against, even for a dynamic channel — /run re-executes the saved filters, not a keyword
// search) — 1 / '' are inert defaults ArticleCard already treats as "no highlight, fall back
// to summary".
function articleToSearchHit(article: Article): SearchHit {
  return {
    articleId: article.id,
    title: article.title,
    summary: article.summary,
    domain: article.domain,
    sourceType: article.sourceType,
    publishedAt: article.publishedAt,
    score: 1,
    highlight: '',
    taxonomyValues: article.taxonomyValues,
    tagIds: article.tagIds,
    hidden: article.hidden,
    createdAt: article.createdAt,
  };
}

interface TagArticleModalProps {
  userTags: UserTag[];
  isApplying: boolean;
  onApply: (tag: UserTag) => void;
  onClose: () => void;
}

// Deliberately smaller than ArticlesPage's TagPickerPopover (search + create + bulk-apply):
// this page only ever tags one article at a time and has no toolbar to anchor a popover to,
// so a simple centered modal (matching SaveQueryModal/LoadQueryModal's established shape)
// covers it without re-implementing that heavier component.
function TagArticleModal({ userTags, isApplying, onApply, onClose }: TagArticleModalProps) {
  const [query, setQuery] = useState('');
  const visible = query.trim()
    ? userTags.filter((tag) => tag.name.toLowerCase().includes(query.trim().toLowerCase()))
    : userTags;

  return (
    <Modal open onClose={onClose} title="Add a tag" size="sm" scrollable>
      <Input
        type="search"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search tags…"
        className="h-9 py-1.5"
      />
      <div className="mt-3 space-y-0.5">
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-secondary)]">No matching tags.</p>
        ) : (
          visible.map((tag) => (
            <button
              key={tag.id}
              type="button"
              disabled={isApplying}
              onClick={() => onApply(tag)}
              className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-button)] px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="min-w-0 truncate">{tag.name}</span>
              <span className="shrink-0 text-xs text-[var(--text-muted)]">{tag.articleCount}</span>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}

export default function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, permissions, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [hidePendingId, setHidePendingId] = useState<string | null>(null);
  const [tagArticleId, setTagArticleId] = useState<string | null>(null);

  // A new channel id (navigating from one channel straight to another) starts fresh —
  // paging/selection/expansion from the previous channel shouldn't carry over.
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
    setExpandedIds(new Set());
  }, [id]);

  const isAppAdmin = permissions.includes('*');
  const canHide = isAppAdmin || permissions.includes('articles:hide');
  const canExport = isAppAdmin || permissions.includes('export:run');

  // ---------------------------------------------------------------------------------
  // Deep-link context (see ChannelsPage's Share button / buildChannelShareUrl above): a
  // shared link carries the sharer's project/group as query params so whoever opens it
  // lands in the same context before running the channel. Consumed once on mount, then
  // stripped from the address bar — same "clean /channels/:id, no cruft" outcome as an
  // ordinary in-app open.
  // ---------------------------------------------------------------------------------
  const appliedDeepLinkRef = useRef(false);
  const deepLinkProjectId = searchParams.get('projectId');
  const deepLinkGroupId = searchParams.get('groupId');

  const setCurrentProjectMutation = useMutation({
    mutationFn: setCurrentProject,
    onSuccess: (updatedUser) => updateUser(updatedUser),
  });
  const setCurrentGroupMutation = useMutation({
    mutationFn: setCurrentGroup,
    onSuccess: (updatedUser) => updateUser(updatedUser),
  });

  useEffect(() => {
    if (appliedDeepLinkRef.current) {
      return;
    }
    if (!deepLinkProjectId && !deepLinkGroupId) {
      return;
    }
    appliedDeepLinkRef.current = true;
    if (deepLinkProjectId && deepLinkProjectId !== user?.currentProjectId) {
      setCurrentProjectMutation.mutate(deepLinkProjectId);
    }
    if (deepLinkGroupId && deepLinkGroupId !== user?.currentGroupId) {
      setCurrentGroupMutation.mutate(deepLinkGroupId);
    }
    setSearchParams({}, { replace: true });
    // Runs at most once per mount (guarded by appliedDeepLinkRef) — deliberately not
    // re-running just because `user` changes, since these same mutations are what update it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkProjectId, deepLinkGroupId]);

  // ---------------------------------------------------------------------------------
  // View preference + concepts/tags for card rendering — same source and fallback logic as
  // ArticlesPage, so a card looks identical whether it's reached via Articles or a channel.
  // ---------------------------------------------------------------------------------
  const settingsQuery = useQuery({ queryKey: ['my-settings'], queryFn: fetchMySettings, staleTime: 60_000 });
  const viewMode: ResultViewMode = settingsQuery.data?.defaultResultView ?? DEFAULT_USER_SETTINGS.defaultResultView;
  const cardContentLinesMap = settingsQuery.data?.cardContentLines ?? DEFAULT_USER_SETTINGS.cardContentLines;
  const currentProjectId = user?.currentProjectId ?? null;
  const contentLines =
    (currentProjectId ? cardContentLinesMap[currentProjectId] : undefined) ?? cardContentLinesMap['default'] ?? 3;
  const pageSize = VIEW_MODE_PAGE_SIZE[viewMode];

  const updateSettingsMutation = useMutation({
    mutationFn: updateMySettings,
    onSuccess: (updated) => queryClient.setQueryData(['my-settings'], updated),
  });

  function handleViewModeChange(mode: ResultViewMode) {
    if (mode === viewMode) {
      return;
    }
    updateSettingsMutation.mutate({ defaultResultView: mode });
    setPage(1);
  }

  const conceptsQuery = useQuery({
    queryKey: ['concepts', currentProjectId],
    queryFn: () => fetchConcepts(currentProjectId as string),
    enabled: currentProjectId !== null,
    staleTime: 5 * 60_000,
  });
  const concepts = useMemo(() => conceptsQuery.data ?? [], [conceptsQuery.data]);

  const userTagsQuery = useQuery({ queryKey: ['user-tags'], queryFn: fetchUserTags, staleTime: 60_000 });
  const userTags = useMemo(() => userTagsQuery.data ?? [], [userTagsQuery.data]);
  const tagsById = useMemo(() => new Map<string, UserTag>(userTags.map((tag) => [tag.id, tag])), [userTags]);

  const groupsQuery = useQuery({ queryKey: ['groups-options'], queryFn: () => fetchGroups(1), staleTime: 5 * 60_000 });
  const groupNameById = useMemo(
    () => new Map((groupsQuery.data?.items ?? []).map((group) => [group.id, group.name])),
    [groupsQuery.data],
  );

  // ---------------------------------------------------------------------------------
  // GET /:id — display metadata only (channelName, group, lastRunAt). Best-effort: if this
  // fails but the /open call below succeeds, the page still renders results just fine, only
  // falling back to plainer header text.
  // ---------------------------------------------------------------------------------
  const channelQuery = useQuery({
    queryKey: ['channel-detail', id],
    queryFn: () => {
      if (!id) throw new Error('Missing channel id.');
      return fetchChannel(id);
    },
    enabled: id !== undefined,
    retry: false,
  });

  // ---------------------------------------------------------------------------------
  // GET /:id/open — the actual "open channel" action: marks this viewer's ChannelView (now),
  // clearing the "new" badge server-side. Re-run on every mount (`refetchOnMount: 'always'`)
  // since navigating to a channel is itself the "open" action each time, not just once per
  // session — 404 (CHANNEL_NOT_FOUND) is a permanent, deterministic state, so retries are
  // disabled rather than wasting two rounds tripping over the same generic 404. Only its
  // `type`/`total` are used for display below — see the /run query for why the actual result
  // *listing* comes from a different endpoint.
  // ---------------------------------------------------------------------------------
  const openQuery = useQuery({
    queryKey: ['channel-open', id],
    queryFn: () => {
      if (!id) throw new Error('Missing channel id.');
      return openChannel(id);
    },
    enabled: id !== undefined,
    retry: false,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    if (openQuery.isSuccess) {
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      void queryClient.invalidateQueries({ queryKey: ['channel-detail', id] });
    }
  }, [openQuery.isSuccess, id, queryClient]);

  const opened = openQuery.data;

  // ---------------------------------------------------------------------------------
  // POST /saved-searches/:id/run — the actual paginated result listing, for BOTH dynamic and
  // snapshot channels alike. Deliberately NOT reusing POST /search here: that endpoint scopes
  // hard/soft filter grants to the CALLER'S current navbar group, whereas a saved search's
  // filters were validated and must always be re-run against the group it was SAVED under
  // (SavedSearch.groupId) regardless of which group the viewer happens to have selected right
  // now — exactly what /run does server-side (see runSavedSearchQuery's buildArticleMongoQuery
  // call), and unlike GET /:id/open's own snapshot branch, it paginates server-side rather
  // than handing back the whole frozen set. Gated on the open call succeeding first, both so
  // this never fires against a channel that just turned out to be inaccessible, and so
  // "opened" (marking viewed) always happens before "run" (viewing results).
  // ---------------------------------------------------------------------------------
  const runQuery = useQuery({
    queryKey: ['channel-run', id, page, pageSize],
    queryFn: () => {
      if (!id) throw new Error('Missing channel id.');
      return runSavedSearch(id, page, pageSize);
    },
    enabled: id !== undefined && openQuery.isSuccess,
  });

  const hits: SearchHit[] = useMemo(
    () => (runQuery.data?.results.hits ?? []).map(articleToSearchHit),
    [runQuery.data],
  );
  const total = runQuery.data?.results.total ?? opened?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openFailedGeneric = openQuery.isError && !(openQuery.error instanceof ChannelAccessError);
  const isAccessDenied = openQuery.isError && openQuery.error instanceof ChannelAccessError;
  const isGridLoading = openQuery.isLoading || runQuery.isLoading;
  const isGridError = openFailedGeneric || runQuery.isError;
  const gridErrorMessage = openFailedGeneric
    ? getApiErrorMessage(openQuery.error, 'Unable to load this channel.')
    : getApiErrorMessage(runQuery.error, 'Unable to load this channel.');

  function handleRetry() {
    if (openFailedGeneric) {
      void openQuery.refetch();
    } else {
      void runQuery.refetch();
    }
  }

  // ---------------------------------------------------------------------------------
  // Selection + expand/collapse
  // ---------------------------------------------------------------------------------
  function handleSelect(articleId: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(articleId);
      else next.delete(articleId);
      return next;
    });
  }

  function handleSelectAllOnPage(selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const hit of hits) {
        if (selected) next.add(hit.articleId);
        else next.delete(hit.articleId);
      }
      return next;
    });
  }

  function handleToggleExpand(articleId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(articleId)) next.delete(articleId);
      else next.add(articleId);
      return next;
    });
  }

  function handleToggleExpandAll() {
    const pageIds = hits.map((hit) => hit.articleId);
    const allExpanded = pageIds.length > 0 && pageIds.every((articleId) => expandedIds.has(articleId));
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const articleId of pageIds) {
        if (allExpanded) next.delete(articleId);
        else next.add(articleId);
      }
      return next;
    });
  }

  // ---------------------------------------------------------------------------------
  // Hide / unhide — both channel types now render off the same /run query (see above), so a
  // plain invalidate-and-refetch picks up the change either way; no cache-patching needed.
  // ---------------------------------------------------------------------------------
  const hideMutation = useMutation({
    mutationFn: ({ articleId, hidden }: { articleId: string; hidden: boolean }) =>
      hidden ? unhideArticle(articleId) : hideArticle(articleId),
    onMutate: ({ articleId }) => setHidePendingId(articleId),
    onSuccess: (_updatedArticle, variables) => {
      toast.success(variables.hidden ? 'Article unhidden.' : 'Article hidden.');
      void queryClient.invalidateQueries({ queryKey: ['channel-run', id] });
    },
    onSettled: () => setHidePendingId(null),
  });

  function handleHideToggle(articleId: string, hidden: boolean) {
    hideMutation.mutate({ articleId, hidden });
  }

  // ---------------------------------------------------------------------------------
  // Tagging — single-article "add tag" via the modal above, funneled through the same
  // bulk-apply endpoint ArticlesPage uses (with a one-element articleIds array).
  // ---------------------------------------------------------------------------------
  const tagMutation = useMutation({
    mutationFn: ({ articleId, tag }: { articleId: string; tag: UserTag }) =>
      bulkApplyUserTag({ articleIds: [articleId], tagId: tag.id }),
    onSuccess: (_result, variables) => {
      toast.success(`Tagged with "${variables.tag.name}".`);
      void queryClient.invalidateQueries({ queryKey: ['channel-run', id] });
      void queryClient.invalidateQueries({ queryKey: ['user-tags'] });
      setTagArticleId(null);
    },
  });

  function handleApplyTag(tag: UserTag) {
    if (!tagArticleId) {
      return;
    }
    tagMutation.mutate({ articleId: tagArticleId, tag });
  }

  // Channels have no editable filter surface of their own (their query is fixed at save
  // time) — taxonomy/tag chips still render for context, but clicking one just points the
  // viewer at where that kind of filtering actually lives.
  function handleTaxonomyValueClick(_conceptKey: string, _value: string) {
    toast('Open Articles to filter by taxonomy values.');
  }
  function handleTagChipClick(_tagId: string) {
    toast('Open Articles to filter by tags.');
  }

  async function handleShare() {
    if (!id) {
      return;
    }
    try {
      await navigator.clipboard.writeText(
        buildChannelShareUrl(id, user?.currentProjectId ?? null, user?.currentGroupId ?? null),
      );
      toast.success('Channel link copied to clipboard.');
    } catch {
      toast.error('Unable to copy link.');
    }
  }

  const exportMutation = useMutation({
    mutationFn: (format: 'xlsx' | 'csv') => {
      const filters = channelQuery.data?.filters;
      if (!filters) {
        throw new Error('Channel filters are not loaded yet.');
      }
      return exportArticles(filters, format);
    },
    onSuccess: () => toast.success('Export started — check your downloads.'),
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Export failed.')),
  });

  if (!id) {
    return (
      <PageBody width="full">
        <Alert variant="error">Invalid channel id.</Alert>
      </PageBody>
    );
  }

  // The API deliberately returns the exact same generic 404 whether this channel doesn't
  // exist or the caller just isn't allowed to see it — this state never distinguishes the
  // two either, by design (see channel.routes.ts's own comment on GET /:id and /:id/open).
  if (isAccessDenied) {
    return (
      <PageBody width="full" className="flex flex-1 flex-col">
        <AccessDeniedState
          title="This channel isn't available"
          description="It may not exist, or you may not have access to it."
          backTo="/channels"
          backLabel="Back to channels"
        />
      </PageBody>
    );
  }

  const title = channelQuery.data ? channelQuery.data.channelName?.trim() || channelQuery.data.name : opened?.name;
  const typeLabel = (channelQuery.data?.type ?? opened?.type) === 'snapshot' ? 'Snapshot' : 'Dynamic';
  const groupName = channelQuery.data ? (groupNameById.get(channelQuery.data.groupId) ?? null) : null;
  const isHeaderLoading = openQuery.isLoading;
  const resultSummary = isHeaderLoading
    ? 'Loading…'
    : `${total.toLocaleString()} result${total === 1 ? '' : 's'}`;
  const description = [groupName, resultSummary].filter(Boolean).join(' · ');

  return (
    <PageBody width="full">
      <PageHeader
        breadcrumbs={<Breadcrumbs items={[{ label: 'Channels', to: '/channels' }, { label: title ?? 'Channel' }]} />}
        title={title ?? 'Channel'}
        description={description}
        actions={
          <>
            <Badge variant="accent">{typeLabel}</Badge>
            <div className="flex items-center gap-1 rounded-[var(--radius-button)] border border-[var(--border)] p-1">
              {VIEW_MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isActive = option.value === viewMode;
                return (
                  <button
                    key={option.value}
                    type="button"
                    title={option.label}
                    onClick={() => handleViewModeChange(option.value)}
                    className="flex h-7 w-7 items-center justify-center rounded-[calc(var(--radius-button)-2px)] transition-colors"
                    style={isActive ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                  </button>
                );
              })}
            </div>
            {canExport && channelQuery.data?.filters ? (
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button variant="outline" size="sm" leftIcon={<Download size={14} />} disabled={exportMutation.isPending}>
                    {exportMutation.isPending ? 'Exporting…' : 'Export'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => exportMutation.mutate('xlsx')}>Export Excel</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => exportMutation.mutate('csv')}>Export CSV</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button variant="outline" size="sm" leftIcon={<Share2 size={14} />} onClick={() => void handleShare()}>
              Share
            </Button>
          </>
        }
      />

      <ArticlesGrid
        hits={hits}
        viewMode={viewMode}
        contentLines={contentLines}
        isLoading={isGridLoading}
        isError={isGridError}
        errorMessage={gridErrorMessage}
        onRetry={handleRetry}
        hasActiveFilters={false}
        onClearFilters={() => undefined}
        selectedIds={selectedIds}
        onSelect={handleSelect}
        onSelectAllOnPage={handleSelectAllOnPage}
        expandedIds={expandedIds}
        onToggleExpand={handleToggleExpand}
        onToggleExpandAll={handleToggleExpandAll}
        concepts={concepts}
        tagsById={tagsById}
        canHide={canHide}
        hidePendingId={hidePendingId}
        onHideToggle={handleHideToggle}
        onOpenTagPicker={setTagArticleId}
        onTaxonomyValueClick={handleTaxonomyValueClick}
        onTagChipClick={handleTagChipClick}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />

      {tagArticleId ? (
        <TagArticleModal
          userTags={userTags}
          isApplying={tagMutation.isPending}
          onApply={handleApplyTag}
          onClose={() => setTagArticleId(null)}
        />
      ) : null}
    </PageBody>
  );
}
