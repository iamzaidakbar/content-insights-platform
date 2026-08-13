import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Grid2x2, Grid3x3, List } from 'lucide-react';

import { FACET_SORT_ORDERS, type FacetSortOrder, type ResultViewMode } from '@content-insights/shared';

import { useAuth } from '../../auth/AuthContext';
import { useDirtyDraft } from '../../hooks/useDirtyDraft';
import { getApiErrorMessage } from '../../lib/api-client';
import { VIEW_MODE_PAGE_SIZE } from '../../lib/article-layout';
import { fetchProjects } from '../../lib/projects-api';
import { useSettings } from '../../settings/SettingsContext';
import Toggle from '../Toggle';
import SettingsSaveBar from './SettingsSaveBar';
import { SETTINGS_SELECT_CLASSNAME, SettingsRow, SettingsSection } from './SettingsSection';

// Mirrors FilterPanel.tsx's own (unexported) FACET_SORT_LABELS — kept as a separate local
// mapping since that one is internal to the filter panel, but the wording must stay in sync
// so "sort facets" reads identically here and in the panel that actually applies it.
const FACET_SORT_LABELS: Record<FacetSortOrder, string> = {
  az: 'A–Z',
  za: 'Z–A',
  countAsc: 'Count: Low–High',
  countDesc: 'Count: High–Low',
};

// Same icon + "(N/page)" labeling ArticlesPage.tsx and ChannelDetailPage.tsx already use for
// this exact enum, so the preference reads identically wherever it's surfaced.
const VIEW_MODE_OPTIONS: { value: ResultViewMode; label: string; icon: typeof List }[] = [
  { value: 'list', label: `List (${VIEW_MODE_PAGE_SIZE.list}/page)`, icon: List },
  { value: 'grid2x2', label: `Grid 2×2 (${VIEW_MODE_PAGE_SIZE.grid2x2}/page)`, icon: Grid2x2 },
  { value: 'grid3x4', label: `Grid 3×4 (${VIEW_MODE_PAGE_SIZE.grid3x4}/page)`, icon: Grid3x3 },
];

const MIN_LINES = 1;
const MAX_LINES = 20;

interface SearchPrefsDraft {
  facetSortOrder: FacetSortOrder;
  hideZeroCountFacets: boolean;
  defaultResultView: ResultViewMode;
  cardContentLines: Record<string, number>;
}

function clampLines(value: number): number {
  if (Number.isNaN(value)) return MIN_LINES;
  return Math.min(MAX_LINES, Math.max(MIN_LINES, Math.round(value)));
}

export default function SearchPreferencesSection() {
  const { user } = useAuth();
  const { settings, updateSetting } = useSettings();
  const committed: SearchPrefsDraft = {
    facetSortOrder: settings.facetSortOrder,
    hideZeroCountFacets: settings.hideZeroCountFacets,
    defaultResultView: settings.defaultResultView,
    cardContentLines: settings.cardContentLines,
  };
  const { draft, setDraft, isDirty, discard } = useDirtyDraft<SearchPrefsDraft>(committed);

  // Same "page 1 only" simplification ArticlesPage/DashboardsPage/UploadPage already make
  // for this exact dropdown-style use case (as opposed to a paginated management list) —
  // and the same query key, so this shares its cache with those pages rather than
  // duplicating the request.
  const projectsQuery = useQuery({ queryKey: ['projects-options'], queryFn: () => fetchProjects(1), staleTime: 5 * 60_000 });
  const projects = useMemo(() => projectsQuery.data?.items ?? [], [projectsQuery.data]);

  function handleSave() {
    if (draft.facetSortOrder !== committed.facetSortOrder) {
      updateSetting('facetSortOrder', draft.facetSortOrder);
    }
    if (draft.hideZeroCountFacets !== committed.hideZeroCountFacets) {
      updateSetting('hideZeroCountFacets', draft.hideZeroCountFacets);
    }
    if (draft.defaultResultView !== committed.defaultResultView) {
      updateSetting('defaultResultView', draft.defaultResultView);
    }
    // cardContentLines is replaced wholesale server-side (never merged key-by-key — see
    // updateUserSettingsSchema's comment), so any change to any single project's line count
    // sends the entire map, not just the one changed entry.
    if (JSON.stringify(draft.cardContentLines) !== JSON.stringify(committed.cardContentLines)) {
      updateSetting('cardContentLines', draft.cardContentLines);
    }
  }

  function setLinesFor(key: string, value: number) {
    setDraft((current) => ({
      ...current,
      cardContentLines: { ...current.cardContentLines, [key]: clampLines(value) },
    }));
  }

  return (
    <div className="space-y-4">
      <SettingsSection title="Search Preferences" description="Defaults applied every time you open Articles.">
        <SettingsRow label="Facet sort order" description="How values within each filter section are ordered by default.">
          <select
            className={SETTINGS_SELECT_CLASSNAME}
            value={draft.facetSortOrder}
            onChange={(event) =>
              setDraft((current) => ({ ...current, facetSortOrder: event.target.value as FacetSortOrder }))
            }
          >
            {FACET_SORT_ORDERS.map((order) => (
              <option key={order} value={order}>
                {FACET_SORT_LABELS[order]}
              </option>
            ))}
          </select>
        </SettingsRow>

        <SettingsRow label="Hide zero-count facets" description="Only show filter values that currently match at least one article.">
          <Toggle
            checked={draft.hideZeroCountFacets}
            onChange={(checked) => setDraft((current) => ({ ...current, hideZeroCountFacets: checked }))}
            label="Hide zero-count facets"
          />
        </SettingsRow>

        <SettingsRow label="Default result view">
          <div className="flex items-center gap-1 rounded-md border border-border p-1">
            {VIEW_MODE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const isActive = draft.defaultResultView === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  title={option.label}
                  onClick={() => setDraft((current) => ({ ...current, defaultResultView: option.value }))}
                  className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs transition-colors"
                  style={
                    isActive
                      ? { backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }
                      : { color: 'var(--muted-foreground)' }
                  }
                >
                  <Icon size={15} strokeWidth={1.75} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Content lines per project"
        description="How many lines of snippet text an article card shows, per project — falls back to Default for any project without its own override."
      >
        <SettingsRow label="Default">
          <input
            type="number"
            min={MIN_LINES}
            max={MAX_LINES}
            value={draft.cardContentLines['default'] ?? 3}
            onChange={(event) => setLinesFor('default', Number(event.target.value))}
            className="w-20 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring"
          />
        </SettingsRow>

        {projectsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-8 animate-shimmer rounded-md" />
            ))}
          </div>
        ) : projectsQuery.isError ? (
          <p className="text-sm text-destructive">
            {getApiErrorMessage(projectsQuery.error, 'Unable to load your projects.')}
          </p>
        ) : (
          projects.map((project) => (
            <SettingsRow
              key={project.id}
              label={project.name}
              description={project.id === user?.currentProjectId ? 'Your current project' : ''}
            >
              <input
                type="number"
                min={MIN_LINES}
                max={MAX_LINES}
                value={draft.cardContentLines[project.id] ?? draft.cardContentLines['default'] ?? 3}
                onChange={(event) => setLinesFor(project.id, Number(event.target.value))}
                className="w-20 rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring"
              />
            </SettingsRow>
          ))
        )}
      </SettingsSection>

      <SettingsSaveBar isDirty={isDirty} onSave={handleSave} onDiscard={discard} />
    </div>
  );
}
