import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  BarChart3,
  Bookmark,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Filter,
  FolderOpen,
  Grid2x2,
  Grid3x3,
  List,
  MoreHorizontal,
  Search as SearchIcon,
  Share2,
  SlidersHorizontal,
  Tag as TagIcon,
  UploadCloud,
  X,
} from 'lucide-react';

import {
  asGroupId,
  ARTICLES_FILTERS_PARAM,
  DEFAULT_USER_SETTINGS,
  EMPTY_ADVANCED_SEARCH,
  EMPTY_FILTER_PANEL_STATE,
  normalizeFilterPanelState,
  parseArticlesUrlState,
  SEARCH_SORT_OPTIONS,
  serializeArticlesUrlState,
  type FilterPanelState,
  type ResultViewMode,
  type SearchHit,
  type SearchSortOption,
  type SourceTypeTab,
  type UserTag,
} from '@content-insights/shared';

import { useAuth } from '../auth/AuthContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { getApiErrorMessage } from '../lib/api-client';
import { VIEW_MODE_PAGE_SIZE } from '../lib/article-layout';
import { bulkArticleOperation, exportArticles, hideArticle, unhideArticle } from '../lib/articles-api';
import { fetchConcepts } from '../lib/concepts-api';
import { fetchGroup, fetchGroupDefaultQueries, fetchGroups } from '../lib/groups-api';
import { fetchProjects } from '../lib/projects-api';
import {
  ARTICLES_LOAD_SAVED_SEARCH_PARAM,
  fetchSavedSearch,
  type LoadSavedSearchResult,
} from '../lib/saved-searches-api';
import { countsByUserTagId, fetchSearchFacets, searchArticles } from '../lib/search-api';
import { fetchMySettings, updateMySettings } from '../lib/settings-api';
import { createUserTag, fetchUserTags } from '../lib/user-tags-api';
import { setCurrentGroup, setCurrentProject } from '../lib/users-api';
import AdvancedSearchModal, {
  AdvancedSearchSummaryBanner,
  type AdvancedSearchApplyResult,
} from '../components/AdvancedSearchModal';
import ArticlesGrid from '../components/ArticlesGrid';
import ArticleTabs from '../components/ArticleTabs';
import FilterPanel, { type FilterPanelConcept } from '../components/FilterPanel';
import Pagination from '../components/Pagination';
import TagSelectPopover from '../components/TagSelectPopover';
import InsightBuilderModal from '../components/insights/InsightBuilderModal';
import SavedQueriesModal from '../components/SavedQueriesModal';
import TeamsShareModal from '../components/teams/TeamsShareModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/DropdownMenu';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/Popover';

const SORT_LABELS: Record<SearchSortOption, string> = {
  relevance: 'Relevance',
  date_desc: 'Newest first',
  date_asc: 'Oldest first',
  title_asc: 'Title A→Z',
  title_desc: 'Title Z→A',
};

interface ViewModeOption {
  value: ResultViewMode;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
}
const VIEW_MODE_OPTIONS: ViewModeOption[] = [
  { value: 'list', icon: List, label: `List (${VIEW_MODE_PAGE_SIZE.list}/page)` },
  { value: 'grid2x2', icon: Grid2x2, label: `Grid 2×2 (${VIEW_MODE_PAGE_SIZE.grid2x2}/page)` },
  { value: 'grid3x4', icon: Grid3x3, label: `Grid 3×4 (${VIEW_MODE_PAGE_SIZE.grid3x4}/page)` },
];

function isAssignmentActiveNow(
  assignment: { startDate?: string | null; endDate?: string | null },
  now: Date = new Date(),
): boolean {
  const start = assignment.startDate ? new Date(assignment.startDate) : null;
  const end = assignment.endDate ? new Date(assignment.endDate) : null;
  return (!start || start <= now) && (!end || end >= now);
}

function toCsvValue(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Client-side CSV export for the bulk "Export selected" action — mirrors the server's
// POST /api/articles/export xlsx column set exactly, but built from data already on the
// page (title/domain/sourceType/publishedAt/hidden/tagIds/summary, all present on
// SearchHit) rather than a round-trip: the export endpoint takes a FilterPanelState, not
// an explicit article-id list, so it has no way to scope to just the current selection.
function downloadSelectedArticlesCsv(hits: SearchHit[], tagsById: Map<string, UserTag>): void {
  const header = ['Title', 'Domain', 'Source Type', 'Published At', 'Hidden', 'Tags', 'Summary'];
  const rows = hits.map((hit) => [
    hit.title,
    hit.domain,
    hit.sourceType,
    hit.publishedAt,
    hit.hidden ? 'Yes' : 'No',
    hit.tagIds.map((id) => tagsById.get(id)?.name ?? id).join(', '),
    hit.summary,
  ]);
  const csv = [header, ...rows].map((row) => row.map(toCsvValue).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'selected-articles.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function SortDropdown({ value, onChange }: { value: SearchSortOption; onChange: (value: SearchSortOption) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-button)] border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 text-xs text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
        >
          <span>Sort: {SORT_LABELS[value]}</span>
          <ChevronDown size={13} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {SEARCH_SORT_OPTIONS.map((option) => (
          <DropdownMenuItem key={option} selected={option === value} onSelect={() => onChange(option)}>
            {SORT_LABELS[option]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TOOLBAR_BTN =
  'flex h-8 items-center gap-1.5 rounded-[var(--radius-button)] border border-[var(--border)] px-2.5 text-xs text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]';

const FILTER_COLUMN_STORAGE_KEY = 'ci:articles-filter-column-open';

function readFilterColumnOpen(): boolean {
  try {
    const raw = window.sessionStorage.getItem(FILTER_COLUMN_STORAGE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

function writeFilterColumnOpen(open: boolean): void {
  try {
    window.sessionStorage.setItem(FILTER_COLUMN_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // ignore
  }
}

// The bulk tag/untag popover is TagSelectPopover (shared with Article detail's own "add
// tag" popover) — previously a local, near-duplicate reimplementation lived here because
// TagSelectPopover.tsx was still on the pre-pivot Tag contract at the time; it has since
// migrated to UserTag/user-tags-api.ts, so this page now just wires up the shared component
// directly (mode 'remove' passes allowCreate={false}, since removing a tag from a selection
// should only ever offer tags that already exist).

interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export default function ArticlesPage() {
  const { user, permissions, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const savedSearchIdToLoad = searchParams.get(ARTICLES_LOAD_SAVED_SEARCH_PARAM);
  const initialUrlState = parseArticlesUrlState(searchParams.get(ARTICLES_FILTERS_PARAM));

  const [page, setPage] = useState(initialUrlState?.page ?? 1);
  const [queryInput, setQueryInput] = useState(initialUrlState?.filters.query ?? '');
  const debouncedQuery = useDebouncedValue(queryInput, 300);
  // When a saved search is applied, ignore stale debounce ticks until the box catches up —
  // otherwise a pending keystroke debounce can overwrite the loaded `filters.query`.
  const pendingLoadQueryRef = useRef<string | null>(null);
  const defaultQueryAppliedRef = useRef(false);
  const skipUrlWriteRef = useRef(false);
  const [urlSyncEnabled, setUrlSyncEnabled] = useState(
    () => Boolean(savedSearchIdToLoad || initialUrlState),
  );

  const [filters, setFilters] = useState<FilterPanelState>(() => {
    if (initialUrlState) {
      return initialUrlState.filters;
    }
    return {
      ...EMPTY_FILTER_PANEL_STATE,
      projectIds: user?.currentProjectId ? [user.currentProjectId] : [],
    };
  });

  // Keeps filters.query in sync with the debounced search box without gating every other
  // filter edit behind the same 300ms delay.
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (pendingLoadQueryRef.current !== null) {
      if (trimmed !== pendingLoadQueryRef.current.trim()) return;
      pendingLoadQueryRef.current = null;
      setFilters((current) => (current.query === trimmed ? current : { ...current, query: trimmed }));
      return;
    }
    setFilters((current) => (current.query === trimmed ? current : { ...current, query: trimmed }));
    setPage(1);
  }, [debouncedQuery]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [hidePendingId, setHidePendingId] = useState<string | null>(null);

  const isDesktop = useIsDesktop();
  const [isFilterColumnVisible, setIsFilterColumnVisible] = useState(readFilterColumnOpen);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useState(false);
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [isLoadOpen, setIsLoadOpen] = useState(false);
  const [tagPickerMode, setTagPickerMode] = useState<'add' | 'remove' | null>(null);
  const [isTeamsShareOpen, setIsTeamsShareOpen] = useState(false);
  const [isInsightBuilderOpen, setIsInsightBuilderOpen] = useState(false);

  // A fresh search invalidates any in-progress bulk selection — acting on rows that just
  // scrolled off-page (or changed shape entirely) would be surprising. BUT: `filters` can
  // also change (e.g. the query-box's own 300ms debounce settling, see `debouncedQuery`
  // above) at a moment that trails well behind the keystroke that caused it — including
  // after the user has since selected a row and opened its tag/untag popover. Skip the
  // reset while that popover is open rather than yank it out from under an in-progress
  // edit with no warning (previously reproducible: search a term → the matching article's
  // card appears and gets selected+tagged within the debounce window → the still-pending
  // debounce fires moments later, wiping `selectedIds` and silently closing the popover
  // the user was actively typing into). Deliberately NOT depending on `tagPickerMode`
  // itself — this should stay a plain "did the search change" effect that happens to no-op
  // while a popover is open, not one that also re-fires (and clears stale-but-intentional
  // selection) the moment that popover is later closed.
  useEffect(() => {
    if (tagPickerMode !== null) return;
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tagPickerMode is read as a guard, not a resync trigger
  }, [filters, page]);

  const currentProjectId = user?.currentProjectId ?? null;
  const currentGroupId = user?.currentGroupId ?? null;
  const isAppAdmin = permissions.includes('*');
  const canHide = isAppAdmin || permissions.includes('articles:hide');
  const canExport = isAppAdmin || permissions.includes('export:run');
  const canShareTeams = isAppAdmin || permissions.includes('ms-teams:share');

  // ---------------------------------------------------------------------------------
  // View preference (list/grid2x2/grid3x4) + configurable card content-line count — read
  // straight from UserSettings via settings-api.ts rather than the settings.search.* shape
  // SettingsContext currently exposes (that context is still mid-migration to the new flat
  // UserSettings contract from this same pivot).
  // ---------------------------------------------------------------------------------
  const settingsQuery = useQuery({ queryKey: ['my-settings'], queryFn: fetchMySettings, staleTime: 60_000 });
  const viewMode: ResultViewMode = settingsQuery.data?.defaultResultView ?? DEFAULT_USER_SETTINGS.defaultResultView;
  const cardContentLinesMap = settingsQuery.data?.cardContentLines ?? DEFAULT_USER_SETTINGS.cardContentLines;
  const contentLines =
    (currentProjectId ? cardContentLinesMap[currentProjectId] : undefined) ?? cardContentLinesMap['default'] ?? 3;
  const pageSize = VIEW_MODE_PAGE_SIZE[viewMode];

  const updateSettingsMutation = useMutation({
    mutationFn: updateMySettings,
    onSuccess: (updated) => queryClient.setQueryData(['my-settings'], updated),
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Failed to save your view preference.')),
  });

  function handleViewModeChange(mode: ResultViewMode) {
    if (mode === viewMode) {
      return;
    }
    updateSettingsMutation.mutate({ defaultResultView: mode });
    setPage(1);
  }

  // ---------------------------------------------------------------------------------
  // Project / group context switchers
  // ---------------------------------------------------------------------------------
  const projectsQuery = useQuery({ queryKey: ['projects-options'], queryFn: () => fetchProjects(1), staleTime: 5 * 60_000 });
  // useMemo (not `?? []` inline) so this array keeps a stable identity across renders when
  // the query data hasn't changed — several useMemo hooks below depend on it.
  const projects = useMemo(() => projectsQuery.data?.items ?? [], [projectsQuery.data]);

  const groupsQuery = useQuery({ queryKey: ['groups-options'], queryFn: () => fetchGroups(1), staleTime: 5 * 60_000 });
  const allGroups = groupsQuery.data?.items ?? [];
  const myGroupIds = new Set(
    (user?.roleAssignments ?? [])
      .filter((assignment) => assignment.groupId !== null && isAssignmentActiveNow(assignment))
      .map((assignment) => assignment.groupId as string),
  );
  // Application Admins may switch into any group in the org to preview its scope; everyone
  // else only into a group they actually belong to (matches the server-side membership
  // check on PATCH /api/users/me/current-group).
  const groupOptions = isAppAdmin ? allGroups : allGroups.filter((group) => myGroupIds.has(group.id));

  const setCurrentProjectMutation = useMutation({
    mutationFn: setCurrentProject,
    onSuccess: (updatedUser) => {
      updateUser(updatedUser);
      setFilters((current) => ({
        ...current,
        projectIds: updatedUser.currentProjectId ? [updatedUser.currentProjectId] : [],
      }));
      setPage(1);
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to switch project.')),
  });

  const setCurrentGroupMutation = useMutation({
    mutationFn: setCurrentGroup,
    onSuccess: (updatedUser) => {
      updateUser(updatedUser);
      setPage(1);
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to switch group.')),
  });

  const previousProjectIdRef = useRef(currentProjectId);
  useEffect(() => {
    if (previousProjectIdRef.current === currentProjectId) {
      return;
    }
    previousProjectIdRef.current = currentProjectId;
    setFilters((current) => ({
      ...current,
      projectIds: currentProjectId ? [currentProjectId] : [],
    }));
    setPage(1);
  }, [currentProjectId]);

  // ---------------------------------------------------------------------------------
  // Concepts (taxonomy labels) + user tags (chip names) for card rendering and filter chips
  // ---------------------------------------------------------------------------------
  const conceptsQuery = useQuery({
    queryKey: ['concepts', currentProjectId],
    queryFn: () => fetchConcepts(currentProjectId as string),
    enabled: currentProjectId !== null,
    staleTime: 5 * 60_000,
  });
  const concepts = useMemo(() => conceptsQuery.data ?? [], [conceptsQuery.data]);

  const userTagsQuery = useQuery({ queryKey: ['user-tags'], queryFn: fetchUserTags, staleTime: 60_000 });
  const userTags = useMemo(() => userTagsQuery.data ?? [], [userTagsQuery.data]);
  // Explicit <string, UserTag> (not inferred from tag.id's branded UserTagId type) — every
  // lookup key elsewhere on this page (FilterPanelState.userTagIds, SearchHit.tagIds) is a
  // plain string, kept that way specifically to avoid this dependency cycle (see UserTag's
  // own file for the same note).
  const tagsById = useMemo(() => new Map<string, UserTag>(userTags.map((tag) => [tag.id, tag])), [userTags]);

  // The current group's hard/soft filter grants — needed to build FilterPanel's
  // FilterPanelConcept[] (which concepts to show, and for hard ones, which values are
  // actually allowed). Application Admins (and anyone else with a global articles:read
  // grant) aren't restricted to any one group's grants server-side, so there's nothing
  // meaningful to fetch here for them — every concept renders as an open, unrestricted
  // section instead (see the fallback branch in filterPanelConcepts below).
  const currentGroupDetailQuery = useQuery({
    queryKey: ['current-group-detail', currentGroupId],
    queryFn: () => fetchGroup(asGroupId(currentGroupId as string)),
    enabled: currentGroupId !== null,
    staleTime: 60_000,
  });
  const currentGroupDataAccess = currentGroupDetailQuery.data?.dataAccess;

  const filterPanelConcepts = useMemo<FilterPanelConcept[]>(() => {
    if (!currentGroupDataAccess) {
      // Reported as 'soft' regardless of the concept's real placement — FilterPanel treats
      // `placement: 'hard'` + `allowedValues: null` as "denied" (see its own isDenied
      // check), which is wrong here: this branch means the caller has a GLOBAL grant with
      // no group to restrict against, i.e. genuinely unrestricted, not denied.
      return concepts.map((concept) => ({
        key: concept.key,
        label: concept.displayLabel,
        placement: 'soft',
        allowedValues: null,
      }));
    }
    const conceptsById = new Map(concepts.map((concept) => [concept.id, concept]));
    const hardEntries = currentGroupDataAccess.hardFilterGrants
      .map((grant): FilterPanelConcept | null => {
        const concept = conceptsById.get(grant.conceptId);
        if (!concept) {
          return null;
        }
        return {
          key: concept.key,
          label: concept.displayLabel,
          placement: 'hard',
          allowedValues: grant.allowedValues,
          denialNote: grant.denialNote ?? null,
        };
      })
      .filter((entry): entry is FilterPanelConcept => entry !== null);
    const softEntries = [...currentGroupDataAccess.softFilterConcepts]
      .sort((a, b) => a.order - b.order)
      .map((grant): FilterPanelConcept | null => {
        const concept = conceptsById.get(grant.conceptId);
        if (!concept) {
          return null;
        }
        return { key: concept.key, label: concept.displayLabel, placement: 'soft', allowedValues: null };
      })
      .filter((entry): entry is FilterPanelConcept => entry !== null);
    return [...hardEntries, ...softEntries];
  }, [concepts, currentGroupDataAccess]);

  // ---------------------------------------------------------------------------------
  // Search + facets
  // ---------------------------------------------------------------------------------
  const searchQuery = useQuery({
    queryKey: ['articles-search', filters, page, pageSize, currentGroupId],
    queryFn: () => searchArticles({ filters, page, size: pageSize }),
  });
  // useMemo (not `?? []` inline) so this array keeps a stable identity across renders when
  // the query data hasn't changed — same rationale as `projects`/`concepts` above; the
  // Teams-share `useMemo` below depends on it.
  const hits = useMemo(() => searchQuery.data?.hits ?? [], [searchQuery.data]);
  const total = searchQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const facetsQuery = useQuery({
    queryKey: ['search-facets', filters, currentGroupId],
    queryFn: () => fetchSearchFacets(filters),
    enabled: isFilterColumnVisible || isFilterDrawerOpen || isAdvancedSearchOpen,
    staleTime: 30_000,
  });

  const hasActiveFilters =
    filters.query.trim().length > 0 ||
    filters.dateFilter !== null ||
    filters.projectIds.length > 0 ||
    Object.keys(filters.taxonomyValues).length > 0 ||
    filters.userTagIds.length > 0 ||
    filters.advancedSearch.enabled ||
    filters.hiddenArticles !== 'exclude';

  // ---------------------------------------------------------------------------------
  // Filter mutators
  // ---------------------------------------------------------------------------------
  function handleTabChange(tab: SourceTypeTab) {
    setFilters((current) => ({ ...current, sourceTypeTab: tab }));
    setPage(1);
  }

  function handleSortChange(sort: SearchSortOption) {
    setFilters((current) => ({ ...current, sort }));
    setPage(1);
  }

  function toggleHiddenMode() {
    setFilters((current) => ({
      ...current,
      hiddenArticles: current.hiddenArticles === 'exclude' ? 'onlyHidden' : 'exclude',
    }));
    setPage(1);
  }

  function clearQueryFilter() {
    setQueryInput('');
    setFilters((current) => ({ ...current, query: '' }));
  }

  function removeProjectFilter(projectId: string) {
    setFilters((current) => ({ ...current, projectIds: current.projectIds.filter((id) => id !== projectId) }));
  }

  function removeTaxonomyValue(conceptKey: string, value: string) {
    setFilters((current) => {
      const values = (current.taxonomyValues[conceptKey] ?? []).filter((existing) => existing !== value);
      const nextTaxonomyValues = { ...current.taxonomyValues };
      if (values.length > 0) {
        nextTaxonomyValues[conceptKey] = values;
      } else {
        delete nextTaxonomyValues[conceptKey];
      }
      return { ...current, taxonomyValues: nextTaxonomyValues };
    });
  }

  function removeUserTagFilter(tagId: string) {
    setFilters((current) => ({ ...current, userTagIds: current.userTagIds.filter((id) => id !== tagId) }));
  }

  function clearHiddenFilter() {
    setFilters((current) => ({ ...current, hiddenArticles: 'exclude' }));
  }

  function handleClearAllFilters() {
    setQueryInput('');
    setFilters({ ...EMPTY_FILTER_PANEL_STATE, projectIds: currentProjectId ? [currentProjectId] : [] });
    setPage(1);
  }

  function handleTaxonomyValueClick(conceptKey: string, value: string) {
    setFilters((current) => {
      const existing = current.taxonomyValues[conceptKey] ?? [];
      if (existing.includes(value)) {
        return current;
      }
      return { ...current, taxonomyValues: { ...current.taxonomyValues, [conceptKey]: [...existing, value] } };
    });
    setPage(1);
  }

  function handleTagChipClick(tagId: string) {
    setFilters((current) =>
      current.userTagIds.includes(tagId) ? current : { ...current, userTagIds: [...current.userTagIds, tagId] },
    );
    setPage(1);
  }

  // FilterPanel is a pure controlled component with no internal draft/Apply gate (see its
  // own module comment) — every edit inside it calls onChange immediately with the full
  // next FilterPanelState, so this just re-runs the search; there's nothing to "apply" or
  // close here (the panel stays open, "Done" closes it from inside FilterPanel itself).
  function handleFilterPanelChange(next: FilterPanelState) {
    setFilters(next);
    setPage(1);
  }

  function toggleFilters() {
    if (isDesktop) {
      setIsFilterColumnVisible((open) => {
        const next = !open;
        writeFilterColumnOpen(next);
        return next;
      });
      return;
    }
    setIsFilterDrawerOpen((open) => !open);
  }

  const isFiltersExpanded = isDesktop ? isFilterColumnVisible : isFilterDrawerOpen;

  // Both the Dynamic and Snapshot branches of a loaded saved search carry `filters` — for a
  // snapshot this re-runs it as a live query against the same criteria rather than pinning
  // the exact frozen article set (`result.items`); a known, smaller nuance separate from the
  // Save-side Dynamic/Snapshot gap this wiring fixes.
  async function applyLoadedSavedSearch(loaded: LoadSavedSearchResult) {
    const targetGroupId = loaded.savedSearch.groupId;
    if (targetGroupId && targetGroupId !== currentGroupId) {
      try {
        await setCurrentGroupMutation.mutateAsync(targetGroupId);
      } catch {
        // Mutation already toasts; still apply filters so Load is not a no-op.
      }
    }
    // Mongoose minimize can strip empty taxonomyValues/userTagIds/etc. from stored docs —
    // normalize before setState so chip/filter code never Object.entries(undefined).
    const nextFilters = normalizeFilterPanelState(loaded.result.filters);
    pendingLoadQueryRef.current = nextFilters.query;
    setFilters(nextFilters);
    setQueryInput(nextFilters.query);
    setPage(1);
    setIsSaveOpen(false);
    setIsLoadOpen(false);
  }

  function handleLoadSavedSearch(loaded: LoadSavedSearchResult) {
    void applyLoadedSavedSearch(loaded);
  }

  // /saved-searches Load navigates here with ?savedSearch=<id> — fetch once, apply filters,
  // then strip the param so refresh doesn't re-apply.
  useEffect(() => {
    if (!savedSearchIdToLoad) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await fetchSavedSearch(savedSearchIdToLoad);
        if (cancelled) return;
        await applyLoadedSavedSearch(loaded);
      } catch (err) {
        if (!cancelled) {
          toast.error(getApiErrorMessage(err, 'Unable to load this saved search.'));
        }
      } finally {
        if (!cancelled) {
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.delete(ARTICLES_LOAD_SAVED_SEARCH_PARAM);
              return next;
            },
            { replace: true },
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the deep-link id changes
  }, [savedSearchIdToLoad]);

  // Group default query: apply once on landing when the URL is not already loading a saved
  // search or a serialized filter state. If the user already has a currentProjectId, only
  // apply that project's default; otherwise pick the group's first configured default and
  // persist the project.
  useEffect(() => {
    if (savedSearchIdToLoad || searchParams.has(ARTICLES_FILTERS_PARAM) || defaultQueryAppliedRef.current) {
      defaultQueryAppliedRef.current = true;
      setUrlSyncEnabled(true);
      return;
    }
    if (!currentGroupId) {
      defaultQueryAppliedRef.current = true;
      setUrlSyncEnabled(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const defaults = await fetchGroupDefaultQueries(asGroupId(currentGroupId));
        if (cancelled) return;
        if (defaults.length === 0) {
          defaultQueryAppliedRef.current = true;
          setUrlSyncEnabled(true);
          return;
        }
        const matched = currentProjectId
          ? defaults.find((entry) => entry.projectId === currentProjectId)
          : defaults[0];
        if (!matched) {
          defaultQueryAppliedRef.current = true;
          setUrlSyncEnabled(true);
          return;
        }
        if (matched.projectId !== currentProjectId) {
          await setCurrentProjectMutation.mutateAsync(matched.projectId);
        }
        if (cancelled) return;
        const loaded = await fetchSavedSearch(matched.savedSearchId);
        if (cancelled) return;
        await applyLoadedSavedSearch(loaded);
        defaultQueryAppliedRef.current = true;
        setUrlSyncEnabled(true);
      } catch (err) {
        defaultQueryAppliedRef.current = true;
        setUrlSyncEnabled(true);
        if (!cancelled) {
          toast.error(getApiErrorMessage(err, 'Unable to apply the group default query.'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per landing, not on every project switch
  }, [currentGroupId, savedSearchIdToLoad]);

  useEffect(() => {
    if (!urlSyncEnabled || savedSearchIdToLoad) {
      return;
    }
    if (skipUrlWriteRef.current) {
      skipUrlWriteRef.current = false;
      return;
    }
    const serialized = serializeArticlesUrlState(filters, page);
    if (searchParams.get(ARTICLES_FILTERS_PARAM) === serialized) {
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(ARTICLES_FILTERS_PARAM, serialized);
        next.delete(ARTICLES_LOAD_SAVED_SEARCH_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [filters, page, urlSyncEnabled, savedSearchIdToLoad, searchParams, setSearchParams]);

  useEffect(() => {
    if (!urlSyncEnabled || savedSearchIdToLoad) {
      return;
    }
    const raw = searchParams.get(ARTICLES_FILTERS_PARAM);
    const serialized = serializeArticlesUrlState(filters, page);
    if (raw === serialized || raw === null) {
      return;
    }
    const parsed = parseArticlesUrlState(raw);
    if (!parsed) {
      return;
    }
    skipUrlWriteRef.current = true;
    pendingLoadQueryRef.current = parsed.filters.query;
    setFilters(parsed.filters);
    setQueryInput(parsed.filters.query);
    setPage(parsed.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate from browser Back/Forward, not from local filter edits
  }, [searchParams]);

  function handleApplyAdvancedSearch(result: AdvancedSearchApplyResult) {
    setFilters((current) => ({ ...current, advancedSearch: result.advancedSearch, dateFilter: result.dateFilter }));
    setPage(1);
  }

  function handleClearAdvancedSearchAndDate() {
    setFilters((current) => ({ ...current, advancedSearch: EMPTY_ADVANCED_SEARCH, dateFilter: null }));
    setPage(1);
  }

  const filterChips = useMemo<FilterChip[]>(() => {
    const chips: FilterChip[] = [];
    const trimmedQuery = filters.query.trim();
    if (trimmedQuery) {
      chips.push({ key: 'query', label: `Search: "${trimmedQuery}"`, onRemove: clearQueryFilter });
    }
    for (const projectId of filters.projectIds) {
      const project = projects.find((candidate) => candidate.id === projectId);
      chips.push({
        key: `project-${projectId}`,
        label: `Project: ${project?.name ?? projectId}`,
        onRemove: () => removeProjectFilter(projectId),
      });
    }
    for (const [conceptKey, values] of Object.entries(filters.taxonomyValues)) {
      const concept = concepts.find((candidate) => candidate.key === conceptKey);
      for (const value of values) {
        chips.push({
          key: `tax-${conceptKey}-${value}`,
          label: `${concept?.displayLabel ?? conceptKey}: ${value}`,
          onRemove: () => removeTaxonomyValue(conceptKey, value),
        });
      }
    }
    for (const tagId of filters.userTagIds) {
      const tag = tagsById.get(tagId);
      chips.push({ key: `tag-${tagId}`, label: `Tag: ${tag?.name ?? tagId}`, onRemove: () => removeUserTagFilter(tagId) });
    }
    // Date range + Advanced Search criteria are summarized by AdvancedSearchSummaryBanner
    // instead of a plain chip here (see its render site below) — it already covers both in
    // one richer, editable banner.
    if (filters.hiddenArticles === 'onlyHidden') {
      chips.push({ key: 'hidden', label: 'Hidden articles only', onRemove: clearHiddenFilter });
    }
    return chips;
  }, [filters, projects, concepts, tagsById]);

  // ---------------------------------------------------------------------------------
  // Selection + expand/collapse
  // ---------------------------------------------------------------------------------
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

  function handleSelectAllOnPage(selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const hit of hits) {
        if (selected) {
          next.add(hit.articleId);
        } else {
          next.delete(hit.articleId);
        }
      }
      return next;
    });
  }

  function handleInvertSelection() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const hit of hits) {
        if (next.has(hit.articleId)) {
          next.delete(hit.articleId);
        } else {
          next.add(hit.articleId);
        }
      }
      return next;
    });
  }

  function handleClearSelection() {
    setSelectedIds(new Set());
  }

  function handleToggleExpand(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleToggleExpandAll() {
    const pageIds = hits.map((hit) => hit.articleId);
    const allExpanded = pageIds.length > 0 && pageIds.every((id) => expandedIds.has(id));
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (allExpanded) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }

  // ---------------------------------------------------------------------------------
  // Hide / unhide — single-card and bulk share the same articles:hide gate
  // ---------------------------------------------------------------------------------
  const hideMutation = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => (hidden ? unhideArticle(id) : hideArticle(id)),
    onMutate: ({ id }) => setHidePendingId(id),
    onSuccess: (_article, variables) => {
      toast.success(variables.hidden ? 'Article unhidden.' : 'Article hidden.');
      void queryClient.invalidateQueries({ queryKey: ['articles-search'] });
      void queryClient.invalidateQueries({ queryKey: ['search-facets'] });
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Unable to update this article.')),
    onSettled: () => setHidePendingId(null),
  });

  function handleHideToggle(id: string, hidden: boolean) {
    hideMutation.mutate({ id, hidden });
  }

  // ---------------------------------------------------------------------------------
  // Bulk actions — hide/unhide/addTags/removeTags all funnel through the one Articles
  // bulk endpoint (POST /api/articles/bulk).
  // ---------------------------------------------------------------------------------
  const bulkMutation = useMutation({
    mutationFn: bulkArticleOperation,
    onSuccess: (result, variables) => {
      if (result.failed > 0) {
        toast.error(`${result.succeeded} of ${result.requested} succeeded — ${result.failed} failed.`);
      } else {
        toast.success(`Updated ${result.succeeded} article${result.succeeded === 1 ? '' : 's'}.`);
      }
      setSelectedIds(new Set());
      setTagPickerMode(null);
      void queryClient.invalidateQueries({ queryKey: ['articles-search'] });
      void queryClient.invalidateQueries({ queryKey: ['search-facets'] });
      if (variables.action === 'addTags' || variables.action === 'removeTags') {
        void queryClient.invalidateQueries({ queryKey: ['user-tags'] });
      }
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Bulk action failed.')),
  });

  function handleBulkHide(hidden: boolean) {
    if (selectedIds.size === 0) {
      return;
    }
    bulkMutation.mutate({ action: hidden ? 'unhide' : 'hide', articleIds: [...selectedIds] });
  }

  const createTagMutation = useMutation({
    mutationFn: createUserTag,
    onSuccess: (tag) => {
      queryClient.setQueryData<UserTag[]>(['user-tags'], (current) => [...(current ?? []), tag]);
    },
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Failed to create tag.')),
  });

  function handleTagPickerApply(tag: UserTag) {
    if (!tagPickerMode || selectedIds.size === 0) {
      return;
    }
    bulkMutation.mutate({
      action: tagPickerMode === 'add' ? 'addTags' : 'removeTags',
      articleIds: [...selectedIds],
      tagIds: [tag.id],
    });
  }

  function handleTagPickerCreate(name: string) {
    createTagMutation.mutate(
      { name, isPrivate: false },
      {
        onSuccess: (tag) => {
          toast.success(`Created "${tag.name}".`);
          handleTagPickerApply(tag);
        },
      },
    );
  }

  function handleOpenTagPickerForCard(id: string) {
    setSelectedIds(new Set([id]));
    setTagPickerMode('add');
  }

  // Opens TeamsShareModal seeded with the current selection. SearchHit has no source URL
  // (only `domain` — see search-result.ts), so `url` here is this app's own article deep
  // link; that's also the only sensible value regardless of the modal's "app deep link vs.
  // original source" toggle, since teams.routes.ts never persists article urls/titles
  // anyway (see TeamsShareModal's own module comment — a share is simulated, not posted).
  const teamsShareArticles = useMemo(
    () =>
      hits
        .filter((hit) => selectedIds.has(hit.articleId))
        .map((hit) => ({ title: hit.title, url: `${window.location.origin}/articles/${hit.articleId}` })),
    [hits, selectedIds],
  );

  function handleOpenTeamsShare() {
    if (selectedIds.size === 0) {
      return;
    }
    setIsTeamsShareOpen(true);
  }

  const exportMutation = useMutation({
    mutationFn: (format: 'xlsx' | 'csv') => exportArticles(filters, format),
    onSuccess: () => toast.success('Export started — check your downloads.'),
    onError: (err: unknown) => toast.error(getApiErrorMessage(err, 'Export failed.')),
  });

  function handleExportSelected() {
    const selectedHits = hits.filter((hit) => selectedIds.has(hit.articleId));
    if (selectedHits.length === 0) {
      return;
    }
    downloadSelectedArticlesCsv(selectedHits, tagsById);
    toast.success(`Exported ${selectedHits.length} article${selectedHits.length === 1 ? '' : 's'}.`);
  }

  const filterPanelProps = {
    value: filters,
    onChange: handleFilterPanelChange,
    concepts: filterPanelConcepts,
    projects,
    userTags,
    facetSortOrder: settingsQuery.data?.facetSortOrder ?? DEFAULT_USER_SETTINGS.facetSortOrder,
    hideZeroCountFacets: settingsQuery.data?.hideZeroCountFacets ?? DEFAULT_USER_SETTINGS.hideZeroCountFacets,
    ...(facetsQuery.data?.facets ? { facets: facetsQuery.data.facets } : {}),
  };

  const userTagCounts = useMemo(
    () => countsByUserTagId(facetsQuery.data?.facets),
    [facetsQuery.data?.facets],
  );

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0">
      {isDesktop ? (
        <FilterPanel
          variant="column"
          isOpen={isFilterColumnVisible}
          onClose={() => {
            setIsFilterColumnVisible(false);
            writeFilterColumnOpen(false);
          }}
          {...filterPanelProps}
        />
      ) : (
        <FilterPanel
          variant="drawer"
          isOpen={isFilterDrawerOpen}
          onClose={() => setIsFilterDrawerOpen(false)}
          {...filterPanelProps}
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-3 pt-2 sm:px-4">
        <div className="shrink-0 space-y-2">
          <ArticleTabs active={filters.sourceTypeTab} onChange={handleTabChange} />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleFilters}
              aria-expanded={isFiltersExpanded}
              className={TOOLBAR_BTN}
              style={isFiltersExpanded ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            >
              <Filter size={13} />
              Filters
            </button>

            <div className="relative min-w-[160px] flex-1">
              <SearchIcon
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              />
              <input
                type="search"
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="Search articles…"
                className="h-9 w-full rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] pl-9 pr-[6.5rem] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                aria-label="Advanced Search"
                onClick={() => setIsAdvancedSearchOpen(true)}
                className="absolute right-1 top-1/2 flex h-7 -translate-y-1/2 items-center gap-1 rounded-[var(--radius-button)] px-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <SlidersHorizontal size={13} />
                Advanced
              </button>
            </div>

            <Link to="/articles/upload" className={TOOLBAR_BTN}>
              <UploadCloud size={13} />
              Upload
            </Link>

            <DropdownMenu>
              <DropdownMenuTrigger>
                <button type="button" aria-label="More actions" className={TOOLBAR_BTN}>
                  <MoreHorizontal size={13} />
                  More
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {groupOptions.length > 0 ? (
                  <DropdownMenuItem onSelect={() => setIsSaveOpen(true)}>
                    <Bookmark size={13} />
                    Save
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => setIsLoadOpen(true)}>
                  <FolderOpen size={13} />
                  Load
                </DropdownMenuItem>
                {groupOptions.length > 0 ? (
                  <DropdownMenuItem onSelect={() => setIsInsightBuilderOpen(true)}>
                    <BarChart3 size={13} />
                    Insights
                  </DropdownMenuItem>
                ) : null}
                {canExport ? (
                  <>
                    <DropdownMenuItem disabled={exportMutation.isPending} onSelect={() => exportMutation.mutate('xlsx')}>
                      <Download size={13} />
                      {exportMutation.isPending ? 'Exporting…' : 'Export Excel'}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={exportMutation.isPending} onSelect={() => exportMutation.mutate('csv')}>
                      <Download size={13} />
                      Export CSV
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem selected={filters.hiddenArticles === 'onlyHidden'} onSelect={toggleHiddenMode}>
                  {filters.hiddenArticles === 'onlyHidden' ? <Eye size={13} /> : <EyeOff size={13} />}
                  {filters.hiddenArticles === 'onlyHidden' ? 'Hidden only' : 'Hidden'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {filterChips.length > 0 ? (
              <>
                {filterChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={chip.onRemove}
                    className="flex items-center gap-1 rounded-[var(--radius-tag)] px-2 py-0.5 text-xs transition-opacity hover:opacity-75"
                    style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
                  >
                    {chip.label}
                    <X size={11} />
                  </button>
                ))}
                <button type="button" onClick={handleClearAllFilters} className="text-xs text-[var(--accent)] hover:underline">
                  Clear all
                </button>
              </>
            ) : null}

            <div className="ml-auto flex items-center gap-1.5">
              <SortDropdown value={filters.sort as SearchSortOption} onChange={handleSortChange} />
              <div className="flex items-center gap-0.5 rounded-[var(--radius-button)] border border-[var(--border)] p-0.5">
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
                      <Icon size={14} strokeWidth={1.75} />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <AdvancedSearchSummaryBanner
            advancedSearch={filters.advancedSearch}
            dateFilter={filters.dateFilter}
            concepts={concepts}
            onEdit={() => setIsAdvancedSearchOpen(true)}
            onClear={handleClearAdvancedSearchAndDate}
          />
        </div>

        {/* Scrollable results between toolbar and pagination */}
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <p
            className="mb-1.5 shrink-0 text-xs text-[var(--text-secondary)]"
            data-testid="results-count"
            aria-live="polite"
          >
            {searchQuery.isLoading ? 'Loading…' : `${total.toLocaleString()} result${total === 1 ? '' : 's'}`}
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            <ArticlesGrid
              hits={hits}
              viewMode={viewMode}
              contentLines={contentLines}
              isLoading={searchQuery.isLoading}
              isError={searchQuery.isError}
              errorMessage={getApiErrorMessage(searchQuery.error, 'Unable to load articles.')}
              onRetry={() => void searchQuery.refetch()}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={handleClearAllFilters}
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
              onOpenTagPicker={handleOpenTagPickerForCard}
              onTaxonomyValueClick={handleTaxonomyValueClick}
              onTagChipClick={handleTagChipClick}
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              showPagination={false}
            />
          </div>
        </div>

        {selectedIds.size > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1.5">
            <span className="text-xs font-medium text-[var(--text-primary)]">{selectedIds.size} selected</span>
            <button type="button" onClick={handleInvertSelection} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              Invert
            </button>
            <button type="button" onClick={handleClearSelection} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              Clear
            </button>
            <span className="h-3.5 w-px bg-[var(--border)]" />

            <Popover open={tagPickerMode === 'add'} onOpenChange={(open) => setTagPickerMode(open ? 'add' : null)}>
              <PopoverTrigger>
                <button
                  type="button"
                  data-testid="bulk-tag-button"
                  className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <TagIcon size={13} />
                  Tag
                </button>
              </PopoverTrigger>
              <PopoverContent>
                <TagSelectPopover
                  tags={userTags}
                  selectedCount={selectedIds.size}
                  isSelecting={bulkMutation.isPending}
                  isCreating={createTagMutation.isPending}
                  allowCreate
                  countsByTagId={userTagCounts}
                  onSelectTag={handleTagPickerApply}
                  onCreateTag={handleTagPickerCreate}
                  onClose={() => setTagPickerMode(null)}
                />
              </PopoverContent>
            </Popover>

            <Popover open={tagPickerMode === 'remove'} onOpenChange={(open) => setTagPickerMode(open ? 'remove' : null)}>
              <PopoverTrigger>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <TagIcon size={13} />
                  Untag
                </button>
              </PopoverTrigger>
              <PopoverContent>
                <TagSelectPopover
                  tags={userTags}
                  selectedCount={selectedIds.size}
                  isSelecting={bulkMutation.isPending}
                  allowCreate={false}
                  countsByTagId={userTagCounts}
                  onSelectTag={handleTagPickerApply}
                  onCreateTag={() => undefined}
                  onClose={() => setTagPickerMode(null)}
                />
              </PopoverContent>
            </Popover>

            {canHide ? (
              <>
                <button
                  type="button"
                  onClick={() => handleBulkHide(false)}
                  disabled={bulkMutation.isPending}
                  className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-60"
                >
                  <EyeOff size={13} />
                  Hide
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkHide(true)}
                  disabled={bulkMutation.isPending}
                  className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-60"
                >
                  <Eye size={13} />
                  Unhide
                </button>
              </>
            ) : null}

            {canShareTeams ? (
              <button
                type="button"
                onClick={handleOpenTeamsShare}
                className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <Share2 size={13} />
                Share to Teams
              </button>
            ) : null}

            {canExport ? (
              <button
                type="button"
                onClick={handleExportSelected}
                className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <Download size={13} />
                Export selected
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Sticky pagination footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--bg-primary)] py-2">
          <p className="text-xs text-[var(--text-muted)]">
            {!searchQuery.isLoading && totalPages > 1
              ? `Page ${page.toLocaleString()} of ${totalPages.toLocaleString()}`
              : null}
          </p>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>

      <AdvancedSearchModal
        isOpen={isAdvancedSearchOpen}
        onClose={() => setIsAdvancedSearchOpen(false)}
        advancedSearch={filters.advancedSearch}
        dateFilter={filters.dateFilter}
        concepts={concepts}
        onApply={handleApplyAdvancedSearch}
        {...(facetsQuery.data ? { facets: facetsQuery.data.facets } : {})}
      />

      {/* SavedQueriesModal owns both the Save (Dynamic/Snapshot picker, name-uniqueness and
          snapshot-cap error surfacing) and Load/browse flows — see its own module for why a
          single component covers both via `initialTab`. */}
      <SavedQueriesModal
        isOpen={isSaveOpen}
        onClose={() => setIsSaveOpen(false)}
        currentFilters={filters}
        {...(currentGroupId ? { currentGroupId } : {})}
        initialTab="save"
        onLoad={handleLoadSavedSearch}
      />

      <SavedQueriesModal
        isOpen={isLoadOpen}
        onClose={() => setIsLoadOpen(false)}
        {...(currentGroupId ? { currentGroupId } : {})}
        initialTab="browse"
        onLoad={handleLoadSavedSearch}
      />

      {/* "Open in Insights" — the wiring InsightBuilderModal's own module comment describes:
          seeds the builder with this page's live `filters`/`concepts` so the resulting
          Insight (once saved) is built from exactly the search the user has on screen. */}
      {isInsightBuilderOpen ? (
        <InsightBuilderModal
          sourceFilters={filters}
          groupOptions={groupOptions.map((group) => ({ id: group.id, name: group.name }))}
          defaultGroupId={currentGroupId}
          projectIds={filters.projectIds}
          concepts={concepts}
          onClose={() => setIsInsightBuilderOpen(false)}
          onSaved={(insight) => {
            toast.success(`Saved "${insight.name}" — find it under Insights.`);
            setIsInsightBuilderOpen(false);
          }}
        />
      ) : null}

      <TeamsShareModal
        isOpen={isTeamsShareOpen}
        onClose={() => setIsTeamsShareOpen(false)}
        articles={teamsShareArticles}
        // Deliberately doesn't close the modal — TeamsShareModal shows its own
        // ConfirmationView (with the "Done" button that calls onClose) after a successful
        // share; closing here would skip straight past that summary. Just clear the bulk
        // selection so the toolbar collapses once the user does close it.
        onShared={() => setSelectedIds(new Set())}
      />
    </div>
  );
}
