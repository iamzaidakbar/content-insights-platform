import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, ListFilter, Plus, ShieldAlert, X } from 'lucide-react';

import {
  SYSTEM_FILTER_KEYS,
  type Concept,
  type ConceptPlacement,
  type FilterLayoutItem,
  type SystemFilterKey,
} from '@content-insights/shared';

import { useAuth } from '../../auth/AuthContext';
import { useDirtyDraft } from '../../hooks/useDirtyDraft';
import { getApiErrorMessage } from '../../lib/api-client';
import { fetchConcepts, updateConcept } from '../../lib/concepts-api';
import { fetchFilterLayout, updateFilterLayout } from '../../lib/filter-layout-api';
import { fetchProjects } from '../../lib/projects-api';
import EmptyState from '../EmptyState';
import SettingsSaveBar from './SettingsSaveBar';
import { SETTINGS_SELECT_CLASSNAME, SettingsSection } from './SettingsSection';

const SYSTEM_FILTER_LABELS: Record<SystemFilterKey, string> = {
  hiddenArticles: 'Hidden Articles',
  datePublished: 'Date Published',
  project: 'Project',
  userTags: 'User Tags',
};

function sortByOrder(items: FilterLayoutItem[]): FilterLayoutItem[] {
  return [...items].sort((a, b) => a.order - b.order);
}

function reindex(items: FilterLayoutItem[]): FilterLayoutItem[] {
  return items.map((item, index) => ({ ...item, order: index }));
}

// Application Admin only (global-settings:manage). Reorder is built as simple up/down-arrow
// buttons rather than full drag-and-drop — an explicit, time-boxed simplification called out
// in the task, not an oversight; the data model (an `order` integer per item) supports either
// UI equally, so upgrading to real drag-and-drop later is a pure frontend change.
export default function FilterLayoutSection() {
  const { permissions } = useAuth();
  const canManage = permissions.includes('*') || permissions.includes('global-settings:manage');

  // '' = the org-wide default layout (FilterLayout.projectId: null); any other value is a
  // specific project's own override layout.
  const [scopeProjectId, setScopeProjectId] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['projects-options'],
    queryFn: () => fetchProjects(1),
    staleTime: 5 * 60_000,
    enabled: canManage,
  });
  const projects = useMemo(() => projectsQuery.data?.items ?? [], [projectsQuery.data]);

  const layoutQuery = useQuery({
    queryKey: ['filter-layout', scopeProjectId || 'default'],
    queryFn: () => fetchFilterLayout(scopeProjectId || undefined),
    enabled: canManage,
  });

  // Concepts are project-scoped (concept.key is only meaningful within its owning project),
  // so they're only fetchable — and addable to a layout — once a specific project is chosen
  // as the scope. The org-wide default layout can still be edited (system filters, reordering,
  // relabeling whatever's already in it), it just can't have new concept items added from
  // this screen.
  const conceptsQuery = useQuery({
    queryKey: ['concepts-for-project', scopeProjectId],
    queryFn: () => fetchConcepts(scopeProjectId),
    enabled: canManage && scopeProjectId.length > 0,
  });

  if (!canManage) {
    return (
      <SettingsSection title="Filter Layout">
        <EmptyState
          icon={ShieldAlert}
          title="Admins only"
          description="You need the global-settings:manage permission to view or change the filter layout."
        />
      </SettingsSection>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Filter Layout"
        description="Controls which filters appear on the left of Articles search, their order, and their display labels. System filters (Date, Project, Hidden, User Tags) can be reordered and relabeled; Concepts additionally have a hard/soft placement."
      >
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)]">Layout scope</label>
          <select
            className={`mt-1 ${SETTINGS_SELECT_CLASSNAME}`}
            value={scopeProjectId}
            onChange={(event) => setScopeProjectId(event.target.value)}
          >
            <option value="">Default (applies across all projects)</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </SettingsSection>

      {layoutQuery.isLoading ? (
        <SettingsSection title="Layout">
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="h-11 animate-shimmer rounded-[var(--radius-input)]" />
            ))}
          </div>
        </SettingsSection>
      ) : layoutQuery.isError ? (
        <SettingsSection title="Layout">
          <p className="text-sm" style={{ color: 'var(--red)' }}>
            {getApiErrorMessage(layoutQuery.error, 'Unable to load this filter layout.')}
          </p>
        </SettingsSection>
      ) : layoutQuery.data ? (
        <FilterLayoutEditor
          key={scopeProjectId}
          scopeProjectId={scopeProjectId}
          committedItems={layoutQuery.data.items}
          concepts={conceptsQuery.data ?? []}
          conceptsLoading={scopeProjectId.length > 0 && conceptsQuery.isLoading}
        />
      ) : null}
    </div>
  );
}

function FilterLayoutEditor({
  scopeProjectId,
  committedItems,
  concepts,
  conceptsLoading,
}: {
  scopeProjectId: string;
  committedItems: FilterLayoutItem[];
  concepts: Concept[];
  conceptsLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const conceptByKey = useMemo(() => new Map(concepts.map((concept) => [concept.key, concept])), [concepts]);

  const itemsDraft = useDirtyDraft<FilterLayoutItem[]>(sortByOrder(committedItems));
  const committedPlacements = useMemo(
    () => Object.fromEntries(concepts.map((concept) => [concept.id, concept.placement])),
    [concepts],
  );
  const placementsDraft = useDirtyDraft<Record<string, ConceptPlacement>>(committedPlacements);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const items = reindex(itemsDraft.draft);
      const [layout] = await Promise.all([
        updateFilterLayout({ projectId: scopeProjectId || null, items }),
        ...Object.entries(placementsDraft.draft)
          .filter(([conceptId, placement]) => committedPlacements[conceptId] !== placement)
          .map(([conceptId, placement]) => updateConcept(conceptId, { placement })),
      ]);
      return layout;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['filter-layout', scopeProjectId || 'default'] });
      if (scopeProjectId) {
        void queryClient.invalidateQueries({ queryKey: ['concepts-for-project', scopeProjectId] });
      }
      toast.success('Filter layout updated.');
    },
  });

  const isDirty = itemsDraft.isDirty || placementsDraft.isDirty;

  function discardAll() {
    itemsDraft.discard();
    placementsDraft.discard();
  }

  const availableSystemKeys = SYSTEM_FILTER_KEYS.filter(
    (key) => !itemsDraft.draft.some((item) => item.kind === 'system' && item.key === key),
  );
  const availableConcepts = concepts.filter(
    (concept) => !itemsDraft.draft.some((item) => item.kind === 'concept' && item.key === concept.key),
  );

  function addItem(item: FilterLayoutItem) {
    itemsDraft.setDraft((current) => [...current, { ...item, order: current.length }]);
  }

  function removeAt(index: number) {
    itemsDraft.setDraft((current) => reindex(current.filter((_, i) => i !== index)));
  }

  function moveAt(index: number, direction: -1 | 1) {
    itemsDraft.setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target] as FilterLayoutItem, next[index] as FilterLayoutItem];
      return reindex(next);
    });
  }

  function relabel(index: number, label: string) {
    itemsDraft.setDraft((current) => current.map((item, i) => (i === index ? { ...item, label } : item)));
  }

  function togglePlacement(conceptId: string, current: ConceptPlacement) {
    placementsDraft.setDraft((draft) => ({ ...draft, [conceptId]: current === 'hard' ? 'soft' : 'hard' }));
  }

  return (
    <>
      <SettingsSection title="Placed filters" description="Top to bottom is the order shown in the filter panel.">
        {itemsDraft.draft.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No filters placed yet — add one below.</p>
        ) : (
          <div className="space-y-2">
            {itemsDraft.draft.map((item, index) => {
              const concept = item.kind === 'concept' ? conceptByKey.get(item.key) : undefined;
              const placement = concept ? placementsDraft.draft[concept.id] ?? concept.placement : undefined;
              return (
                <div
                  key={`${item.kind}:${item.key}`}
                  className="flex items-center gap-3 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-surface)] p-2.5"
                >
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => moveAt(index, -1)}
                      disabled={index === 0}
                      aria-label="Move up"
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveAt(index, 1)}
                      disabled={index === itemsDraft.draft.length - 1}
                      aria-label="Move down"
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>

                  <span
                    className="shrink-0 rounded-[var(--radius-tag)] px-2 py-0.5 text-xs"
                    style={{ backgroundColor: 'var(--tag-bg)', color: 'var(--tag-text)' }}
                  >
                    {item.kind === 'system' ? 'System' : 'Concept'}
                  </span>

                  <input
                    type="text"
                    value={item.label}
                    onChange={(event) => relabel(index, event.target.value)}
                    maxLength={100}
                    className="min-w-0 flex-1 rounded-[var(--radius-input)] border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />

                  {item.kind === 'concept' ? (
                    concept && placement ? (
                      <div className="flex shrink-0 items-center gap-1 rounded-[var(--radius-button)] border border-[var(--border)] p-0.5 text-xs">
                        {(['hard', 'soft'] as ConceptPlacement[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => togglePlacement(concept.id, placement)}
                            className="rounded-[calc(var(--radius-button)-2px)] px-2 py-1 capitalize transition-colors"
                            style={
                              placement === option
                                ? { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }
                                : { color: 'var(--text-secondary)' }
                            }
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="shrink-0 text-xs text-[var(--text-muted)]">Hard/soft: switch to this project</span>
                    )
                  ) : null}

                  <button
                    type="button"
                    onClick={() => removeAt(index)}
                    aria-label="Remove"
                    className="shrink-0 text-[var(--text-secondary)] hover:text-[var(--red)]"
                  >
                    <X size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Add a filter">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">System filter</label>
            <div className="mt-1 flex items-center gap-2">
              <select
                id="add-system-filter"
                className={SETTINGS_SELECT_CLASSNAME}
                disabled={availableSystemKeys.length === 0}
                defaultValue=""
                onChange={(event) => {
                  const key = event.target.value as SystemFilterKey;
                  if (!key) return;
                  addItem({ kind: 'system', key, order: 0, label: SYSTEM_FILTER_LABELS[key] });
                  event.target.value = '';
                }}
              >
                <option value="" disabled>
                  {availableSystemKeys.length === 0 ? 'All placed' : 'Select…'}
                </option>
                {availableSystemKeys.map((key) => (
                  <option key={key} value={key}>
                    {SYSTEM_FILTER_LABELS[key]}
                  </option>
                ))}
              </select>
              <Plus size={16} className="text-[var(--text-muted)]" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">Concept</label>
            <div className="mt-1 flex items-center gap-2">
              <select
                className={SETTINGS_SELECT_CLASSNAME}
                disabled={!scopeProjectId || availableConcepts.length === 0}
                defaultValue=""
                onChange={(event) => {
                  const key = event.target.value;
                  const concept = concepts.find((candidate) => candidate.key === key);
                  if (!concept) return;
                  addItem({ kind: 'concept', key: concept.key, order: 0, label: concept.displayLabel });
                  event.target.value = '';
                }}
              >
                <option value="" disabled>
                  {!scopeProjectId
                    ? 'Pick a project above'
                    : conceptsLoading
                      ? 'Loading…'
                      : availableConcepts.length === 0
                        ? 'All placed'
                        : 'Select…'}
                </option>
                {availableConcepts.map((concept) => (
                  <option key={concept.id} value={concept.key}>
                    {concept.displayLabel}
                  </option>
                ))}
              </select>
              <Plus size={16} className="text-[var(--text-muted)]" />
            </div>
          </div>
        </div>
        {!scopeProjectId ? (
          <p className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <ListFilter size={12} /> Concepts belong to a specific project — choose one above to add its concepts here.
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSaveBar
        isDirty={isDirty}
        isSaving={saveMutation.isPending}
        onSave={() => saveMutation.mutate()}
        onDiscard={discardAll}
      />
    </>
  );
}
