import { useEffect, useRef, useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlignJustify,
  ChevronDown,
  Filter,
  Grid2x2,
  Grid3x3,
  Info,
  List,
  Search as SearchIcon,
  SlidersHorizontal,
  Tag as TagIcon,
} from 'lucide-react';

import {
  EMPTY_SEARCH_FILTERS,
  type ArticleContentType,
  type SearchFilters,
  type SearchLayout,
  type SearchPageSize,
  type SearchSort,
  type Tag,
} from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import { useSettings } from '../settings/SettingsContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useClickOutside } from '../hooks/useClickOutside';
import { getApiErrorMessage } from '../lib/api-client';
import { fetchDocuments, fetchProjectIds } from '../lib/documents-api';
import { searchDocuments } from '../lib/search-api';
import { createTag, fetchTags } from '../lib/tags-api';
import ArticleTabs, { type ArticleTabKey } from '../components/ArticleTabs';
import ArticlesGrid, { type ArticleGridItem } from '../components/ArticlesGrid';
import FilterPanel from '../components/FilterPanel';
import AdvancedSearchModal, { type AdvancedSearchResult } from '../components/AdvancedSearchModal';
import TagsPanel from '../components/TagsPanel';
import TagSelectPopover from '../components/TagSelectPopover';

// ES highlight fragments carry literal <mark>/</mark> markers (see lib/search.ts on the
// API side); ArticleCard's snippet prop is plain text, so strip them here rather than
// teaching the card about search-specific markup.
function stripHighlightMarks(fragment: string): string {
  return fragment.replace(/<\/?mark>/g, '');
}

const SORT_LABELS: Record<SearchSort, string> = {
  publishDate: 'Publish Date',
  relevance: 'Relevance',
  source: 'Source',
};
const SORT_OPTIONS: SearchSort[] = ['publishDate', 'relevance', 'source'];
const PAGE_SIZE_OPTIONS: SearchPageSize[] = [12, 24, 48];

const CONTENT_TYPE_VALUES: ArticleContentType[] = ['news', 'document', 'report'];

// Keeps the results bookmarkable/shareable — every entry point (typing, Filter Panel
// Apply, Advanced Search submit, tag-chip click, page change) funnels through filters/
// query/page state, and one effect in the component below mirrors all of it here.
function filtersToSearchParams(filters: SearchFilters, query: string, page: number): URLSearchParams {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (page > 1) params.set('page', String(page));
  if (filters.dateRange.start) params.set('from', filters.dateRange.start);
  if (filters.dateRange.end) params.set('to', filters.dateRange.end);
  if (filters.contentType) params.set('contentType', filters.contentType);
  if (filters.tags.length > 0) params.set('tags', filters.tags.join(','));
  if (filters.languages.length > 0) params.set('languages', filters.languages.join(','));
  if (filters.projects.length > 0) params.set('projects', filters.projects.join(','));
  if (filters.sources.length > 0) params.set('sources', filters.sources.join(','));
  return params;
}

function hasAnyFilterParams(params: URLSearchParams): boolean {
  return ['from', 'to', 'contentType', 'tags', 'languages', 'projects', 'sources'].some((key) =>
    params.has(key),
  );
}

function splitParam(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

function searchParamsToFilters(params: URLSearchParams): SearchFilters {
  const contentTypeRaw = params.get('contentType');
  const contentType = CONTENT_TYPE_VALUES.includes(contentTypeRaw as ArticleContentType)
    ? (contentTypeRaw as ArticleContentType)
    : null;

  return {
    dateRange: {
      start: params.get('from') ?? undefined,
      end: params.get('to') ?? undefined,
    },
    sources: splitParam(params.get('sources')),
    contentType,
    tags: splitParam(params.get('tags')),
    languages: splitParam(params.get('languages')),
    projects: splitParam(params.get('projects')),
  };
}

interface LayoutOption {
  value: SearchLayout;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
}
const LAYOUT_OPTIONS: LayoutOption[] = [
  { value: '1col', icon: List, label: 'List view' },
  { value: '2col', icon: Grid2x2, label: '2-column grid' },
  { value: '3col', icon: Grid3x3, label: '3-column grid' },
  { value: 'dense', icon: AlignJustify, label: 'Dense view' },
];
// Toolbar shows the 3 most common layouts as a quick switcher; the results-meta row
// (below) exposes all 4 — both read/write the same settings.search.defaultLayout, so
// they always agree on which one is active.
const TOOLBAR_LAYOUT_OPTIONS = LAYOUT_OPTIONS.filter((option) => option.value !== 'dense');

function SortByDropdown({ value, onChange }: { value: SearchSort; onChange: (v: SearchSort) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, () => setIsOpen(false));

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-9 items-center gap-2 whitespace-nowrap rounded-[var(--radius-button)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
      >
        <span>Sort By: {SORT_LABELS[value]}</span>
        <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen ? (
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-1 shadow-lg">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
              className={`block w-full rounded-[var(--radius-button)] px-2 py-1.5 text-left text-sm transition-colors ${
                option === value
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              {SORT_LABELS[option]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PerPageDropdown({
  value,
  onChange,
}: {
  value: SearchPageSize;
  onChange: (v: SearchPageSize) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, () => setIsOpen(false));

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-9 items-center gap-2 whitespace-nowrap rounded-[var(--radius-button)] border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
      >
        <span>Per page: {value}</span>
        <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen ? (
        <div className="absolute right-0 z-20 mt-1 w-28 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-1 shadow-lg">
          {PAGE_SIZE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange(option);
                setIsOpen(false);
              }}
              className={`block w-full rounded-[var(--radius-button)] px-2 py-1.5 text-left text-sm transition-colors ${
                option === value
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ArticlesPage() {
  const { permissions } = useAuth();
  const { settings, updateSetting } = useSettings();
  const { defaultLayout: layout, defaultSort: sortBy, defaultPageSize: pageSize } = settings.search;
  const queryClient = useQueryClient();

  const resultsTopRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<ArticleTabKey>('all');
  const [page, setPage] = useState<number>(() => {
    const raw = Number(searchParams.get('page'));
    return Number.isInteger(raw) && raw > 0 ? raw : 1;
  });
  const [rawQuery, setRawQuery] = useState(() => searchParams.get('q') ?? '');
  const debouncedQuery = useDebouncedValue(rawQuery, 300);
  const trimmedQuery = debouncedQuery.trim();
  const hasQuery = trimmedQuery.length > 0;

  // URL params win (shareable link) over the last-persisted server value, which itself
  // wins over an empty default — restores settings.search.lastUsedFilters "if present"
  // per spec, but only on first mount, never retroactively once the user has started
  // interacting with this page.
  const [filters, setFilters] = useState<SearchFilters>(() =>
    hasAnyFilterParams(searchParams) ? searchParamsToFilters(searchParams) : (settings.search.lastUsedFilters ?? EMPTY_SEARCH_FILTERS),
  );

  const activeFilterCount =
    (filters.dateRange.start || filters.dateRange.end ? 1 : 0) +
    filters.sources.length +
    (filters.contentType ? 1 : 0) +
    filters.tags.length +
    filters.languages.length +
    filters.projects.length;
  const hasActiveFilters = hasQuery || activeFilterCount > 0;

  useEffect(() => {
    setSearchParams(filtersToSearchParams(filters, trimmedQuery, page), { replace: true });
    // Only these three should trigger a URL sync — searchParams/setSearchParams
    // themselves are stable-ish but re-running on their identity would fight with the
    // browser back/forward button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, trimmedQuery, page]);

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useState(false);
  const [isTagsPanelOpen, setIsTagsPanelOpen] = useState(false);
  const [isTagSelectOpen, setIsTagSelectOpen] = useState(false);
  const tagSelectAnchorRef = useRef<HTMLDivElement>(null);

  const [isChannelsOpen, setIsChannelsOpen] = useState(false);
  const [areArticlesHidden, setAreArticlesHidden] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // ArticleCard has no bookmarked-display prop per its spec — this only needs the
  // setter, to know which id to toggle; nothing currently renders off the read value.
  const [, setBookmarkedIds] = useState<Set<string>>(new Set());

  const canUpload = permissions.includes('documents:write') || permissions.includes('*');
  const isNewsTab = activeTab === 'news';

  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: fetchTags, staleTime: 60_000 });
  const tags = tagsQuery.data ?? [];

  // Same query key SearchPage.tsx already uses for this exact endpoint — shares its cache
  // rather than colliding with it.
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: fetchProjectIds, staleTime: 5 * 60_000 });
  const projectOptions = projectsQuery.data ?? [];

  const createTagMutation = useMutation({
    mutationFn: createTag,
    onSuccess: (tag) => {
      queryClient.setQueryData<Tag[]>(['tags'], (current) => [...(current ?? []), tag]);
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Failed to create tag.')),
  });

  function applyFilters(next: SearchFilters) {
    setFilters(next);
    setPage(1);
    updateSetting('search.lastUsedFilters', next);
    if (next.contentType === 'news') {
      setActiveTab('news');
    } else if (activeTab === 'news') {
      setActiveTab('all');
    }
  }

  function handleClearFilters() {
    setRawQuery('');
    setFilters(EMPTY_SEARCH_FILTERS);
    setPage(1);
    updateSetting('search.lastUsedFilters', EMPTY_SEARCH_FILTERS);
    if (activeTab === 'news') {
      setActiveTab('all');
    }
  }

  function changeTab(tab: ArticleTabKey) {
    setActiveTab(tab);
    setPage(1);
  }

  function handlePageChange(nextPage: number) {
    setPage(nextPage);
    // Explicit UX requirement: scroll back to the top of the results on page change (the
    // toolbar/tabs above stay put) rather than leaving the user scrolled mid-list.
    resultsTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleLayoutChange(value: SearchLayout) {
    updateSetting('search.defaultLayout', value);
  }
  function handleSortChange(value: SearchSort) {
    updateSetting('search.defaultSort', value);
  }
  function handlePageSizeChange(value: SearchPageSize) {
    updateSetting('search.defaultPageSize', value);
    setPage(1);
  }

  function handleSelect(id: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function handleSelectAll(selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of items) {
        if (selected) {
          next.add(item.id);
        } else {
          next.delete(item.id);
        }
      }
      return next;
    });
  }

  function handleTagSelectedClick() {
    if (selectedIds.size === 0) {
      toast('Select one or more articles first.');
      return;
    }
    setIsTagSelectOpen((open) => !open);
  }

  // No document-tagging association endpoint exists yet (Document has no tags field, and
  // none is proposed here) — applying an existing/newly-created tag to the checked
  // articles stays UI-complete-but-stubbed, matching this page's other still-"coming
  // soon" bulk actions (handleTag/handleEdit below). Tag *creation* itself is real and
  // persisted.
  function handleApplyTagToSelected(tag: Tag) {
    toast(`Tagged ${selectedIds.size} article${selectedIds.size === 1 ? '' : 's'} with "${tag.name}" — coming soon.`);
    setIsTagSelectOpen(false);
  }

  function handleCreateAndApplyTag(input: { name: string; color: string }) {
    createTagMutation.mutate(input, {
      onSuccess: (tag) => {
        toast.success(`Created "${tag.name}".`);
        handleApplyTagToSelected(tag);
      },
    });
  }

  function handleTag(_id: string) {
    toast('Tagging is coming soon.');
  }

  async function handleShare(id: string) {
    const shareUrl = `${window.location.origin}/documents/${id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied to clipboard.');
    } catch {
      toast.error('Unable to copy link.');
    }
  }

  function handleBookmark(id: string) {
    setBookmarkedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        toast('Removed from saved articles.');
      } else {
        next.add(id);
        toast.success('Saved.');
      }
      return next;
    });
  }

  function handleEdit(_id: string) {
    toast('Editing is coming soon.');
  }

  // Shared by the Tags panel's row click and each card's clickable tag chips — both
  // "add that tag as an active filter" per spec. Applied immediately (no Apply Filters
  // gate), unlike the Filter Panel's other sections.
  function handleTagChipClick(tagName: string) {
    setFilters((current) =>
      current.tags.includes(tagName) ? current : { ...current, tags: [...current.tags, tagName] },
    );
    setPage(1);
    setIsTagsPanelOpen(false);
  }

  function handleAdvancedSearch(result: AdvancedSearchResult) {
    setRawQuery(result.query);
    setFilters((current) => ({
      ...current,
      dateRange: result.dateRange,
      contentType: result.contentType,
      tags: result.tags,
    }));
    setPage(1);
    if (result.contentType === 'news') {
      setActiveTab('news');
    }
    // sourceUrlContains is intentionally not merged in here — no url field exists on an
    // indexed chunk to filter against server-side (see AdvancedSearchModal's own comment).
  }

  const listQuery = useQuery({
    queryKey: ['documents-list', page, pageSize, filters.projects, filters.dateRange],
    queryFn: () =>
      fetchDocuments({
        page,
        pageSize,
        projectIds: filters.projects,
        dateRange: filters.dateRange,
      }),
    enabled: !isNewsTab && !hasQuery,
    // Deliberately no keepPreviousData — the spec calls for skeleton cards on every page
    // change, not the old page's cards lingering while the next one loads.
  });

  const searchQuery = useQuery({
    queryKey: ['articles-search', trimmedQuery, filters.projects, filters.dateRange, page, pageSize],
    queryFn: () =>
      searchDocuments({
        query: trimmedQuery,
        fileTypes: [],
        projectIds: filters.projects,
        dateRange: filters.dateRange,
        page,
        size: pageSize,
      }),
    enabled: !isNewsTab && hasQuery,
  });

  const activeQuery = hasQuery ? searchQuery : listQuery;
  const isLoading = !isNewsTab && activeQuery.isLoading;
  const isError = !isNewsTab && activeQuery.isError;

  const items: ArticleGridItem[] = hasQuery
    ? (searchQuery.data?.hits ?? []).map((hit) => ({
        id: hit.docId,
        title: hit.title,
        publishDate: hit.createdAt,
        snippet: stripHighlightMarks(hit.highlight),
        tags: [],
      }))
    : (listQuery.data?.items ?? []).map((doc) => {
        const wordCount = typeof doc.metadata.wordCount === 'number' ? doc.metadata.wordCount : undefined;
        return {
          id: doc.id,
          title: doc.title,
          publishDate: doc.createdAt,
          snippet:
            wordCount !== undefined
              ? `${doc.originalFilename} · ${wordCount.toLocaleString()} words`
              : doc.originalFilename,
          tags: [],
        };
      });

  const total = hasQuery ? (searchQuery.data?.total ?? 0) : (listQuery.data?.total ?? 0);
  const totalPages = hasQuery
    ? Math.max(1, Math.ceil((searchQuery.data?.total ?? 0) / pageSize))
    : (listQuery.data?.totalPages ?? 1);

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <div className="flex items-center justify-between gap-4">
        <ArticleTabs active={activeTab} onChange={changeTab} />
        {canUpload ? (
          <Link
            to="/documents/upload"
            className="shrink-0 text-sm text-[var(--accent)] hover:underline"
          >
            Upload document
          </Link>
        ) : null}
      </div>

      {/* Toolbar row */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsFilterOpen(true)}
            className="flex h-9 items-center gap-2 rounded-[var(--radius-button)] bg-[var(--accent)] px-3 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            <Filter size={16} />
            Filter
            {activeFilterCount > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-xs font-semibold text-[var(--accent)]">
                {activeFilterCount}
              </span>
            ) : null}
          </button>

          <div className="relative">
            <SearchIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              type="search"
              value={rawQuery}
              onChange={(event) => {
                setRawQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search articles…"
              className="h-9 w-[340px] rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] pl-9 pr-9 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            />
            <span
              title="Search across titles and content. Use the Filter button or Advanced Search to narrow results."
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            >
              <Info size={15} />
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => toast('View Insights is coming soon.')}
            className="h-9 rounded-[var(--radius-button)] border border-[var(--border)] px-3 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
          >
            View Insights
          </button>
          <button
            type="button"
            onClick={() => setIsAdvancedSearchOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] border border-[var(--border)] px-3 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
          >
            <SlidersHorizontal size={14} />
            Advanced Search
          </button>

          <SortByDropdown value={sortBy} onChange={handleSortChange} />
          <PerPageDropdown value={pageSize} onChange={handlePageSizeChange} />

          <div className="flex items-center gap-1 rounded-[var(--radius-button)] border border-[var(--border)] p-1">
            {TOOLBAR_LAYOUT_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = option.value === layout;
              return (
                <button
                  key={option.value}
                  type="button"
                  title={option.label}
                  onClick={() => handleLayoutChange(option.value)}
                  className="flex h-7 w-7 items-center justify-center rounded-[calc(var(--radius-button)-2px)] transition-colors"
                  style={
                    isActive
                      ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }
                      : undefined
                  }
                >
                  <Icon size={15} strokeWidth={1.75} />
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              setIsChannelsOpen((open) => !open);
              setIsTagsPanelOpen(false);
            }}
            className="flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] border px-3 text-sm transition-colors"
            style={
              isChannelsOpen
                ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                : { borderColor: 'var(--border)', color: 'var(--text-primary)' }
            }
          >
            Channels {isChannelsOpen ? '→' : '←'}
          </button>
        </div>
      </div>

      <div className="mt-6 flex gap-6">
        <div ref={resultsTopRef} className="min-w-0 flex-1 scroll-mt-4">
          {/* Results meta row */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
            <p className="text-sm text-[var(--text-secondary)]">
              {isNewsTab
                ? 'No results'
                : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()} Results`}
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1 rounded-[var(--radius-button)] border border-[var(--border)] p-1">
                {LAYOUT_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const isActive = option.value === layout;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      title={option.label}
                      onClick={() => handleLayoutChange(option.value)}
                      className="flex h-7 w-7 items-center justify-center rounded-[calc(var(--radius-button)-2px)] transition-colors"
                      style={
                        isActive
                          ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }
                          : undefined
                      }
                    >
                      <Icon size={15} strokeWidth={1.75} />
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 text-sm">
                <div className="relative" ref={tagSelectAnchorRef}>
                  <button
                    type="button"
                    onClick={handleTagSelectedClick}
                    disabled={selectedIds.size === 0}
                    className={`flex h-9 items-center gap-1.5 rounded-[var(--radius-button)] px-3 transition-colors disabled:cursor-not-allowed ${
                      selectedIds.size > 0
                        ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
                        : 'text-[var(--text-secondary)] opacity-40'
                    }`}
                  >
                    <TagIcon size={14} />
                    Tag Selected
                  </button>
                  {isTagSelectOpen ? (
                    <TagSelectPopover
                      tags={tags}
                      selectedCount={selectedIds.size}
                      isCreating={createTagMutation.isPending}
                      onSelectTag={handleApplyTagToSelected}
                      onCreateTag={handleCreateAndApplyTag}
                      onClose={() => setIsTagSelectOpen(false)}
                    />
                  ) : null}
                </div>
                {selectedIds.size > 0 ? (
                  <span
                    className="rounded-[var(--radius-tag)] px-2 py-1 text-xs font-medium"
                    style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
                  >
                    {selectedIds.size} selected
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setIsTagsPanelOpen((open) => !open);
                    setIsChannelsOpen(false);
                  }}
                  className="text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                >
                  View All Tags
                </button>
                {/* "View full content" now lives on each ArticleCard itself (its Preview
                    icon) — a page-level toggle would have nothing left to drive once
                    every card manages its own expand/collapse. */}
                <button
                  type="button"
                  onClick={() => setAreArticlesHidden((v) => !v)}
                  className="text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                >
                  {areArticlesHidden ? 'Show Articles' : 'Hide Articles'}
                </button>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="mt-4">
            {isNewsTab ? (
              <div className="py-12 text-center">
                <p className="text-[var(--text-secondary)]">
                  No news source is connected yet. Showing article results from your
                  organization&apos;s documents in the meantime.
                </p>
              </div>
            ) : areArticlesHidden ? (
              <p className="py-12 text-center text-sm text-[var(--text-muted)]">
                Results hidden. Click &quot;Show Articles&quot; to bring them back.
              </p>
            ) : (
              <ArticlesGrid
                items={items}
                isLoading={isLoading}
                isError={isError}
                errorMessage={getApiErrorMessage(activeQuery.error, 'Unable to load articles.')}
                onRetry={() => void activeQuery.refetch()}
                onClearFilters={handleClearFilters}
                hasActiveFilters={hasActiveFilters}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onSelectAll={handleSelectAll}
                onTag={handleTag}
                onShare={(id) => void handleShare(id)}
                onBookmark={handleBookmark}
                onEdit={handleEdit}
                onTagClick={handleTagChipClick}
                page={page}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                skeletonCount={Math.min(pageSize, 12)}
              />
            )}
          </div>
        </div>

        {isChannelsOpen ? (
          <aside className="w-64 shrink-0 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Channels</h3>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              No channels connected yet.
            </p>
          </aside>
        ) : null}

        {isTagsPanelOpen ? (
          <TagsPanel
            tags={tags}
            isLoading={tagsQuery.isLoading}
            onTagClick={(tag) => handleTagChipClick(tag.name)}
            onClose={() => setIsTagsPanelOpen(false)}
          />
        ) : null}
      </div>

      <FilterPanel
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        filters={filters}
        onApply={applyFilters}
        onClearAll={handleClearFilters}
        projectOptions={projectOptions}
        tags={tags}
      />

      <AdvancedSearchModal
        isOpen={isAdvancedSearchOpen}
        onClose={() => setIsAdvancedSearchOpen(false)}
        onSearch={handleAdvancedSearch}
        tags={tags}
      />
    </div>
  );
}
