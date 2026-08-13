import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Plus, X } from 'lucide-react';

import {
  CHART_TYPES,
  INSIGHT_NAME_MAX_LENGTH,
  WORD_CLOUD_MAX_WORDS,
  type ChartFieldMapping,
  type ChartType,
  type Concept,
  type CreateInsightInput,
  type FilterPanelState,
  type Insight,
  type InsightConfig,
  type UpdateInsightInput,
  type WordCloudConfig,
} from '@content-insights/shared';

import ErrorBoundary from '../ErrorBoundary';
import { resolveChartRenderer } from '../charts/chart-registry';
import type { ChartSeriesMeta } from '../charts/chart-types';
import Button from '../ui/button';
import { Input, Select } from '../ui/input';
import Modal from '../ui/Modal';
import { cn } from '../../lib/cn';
import { getApiErrorMessage } from '../../lib/api-client';
import { CHART_FIELD_SLOTS, CHART_TYPE_META, isRoleSatisfied } from '../../lib/insight-chart-config';
import { createInsight, updateInsight } from '../../lib/insights-api';

const DEFAULT_WORD_CLOUD: WordCloudConfig = {
  maxWords: 100,
  minOccurrence: 1,
  permanentExclusions: [],
  temporaryExclusions: [],
};

const SAMPLE_LABELS = ['Sample A', 'Sample B', 'Sample C', 'Sample D', 'Sample E'];

// Deterministic (not Math.random()) so the preview doesn't jitter on every re-render —
// purely illustrative, never presented as real data (see the "Sample preview" caption).
function sampleValue(seed: number): number {
  return ((seed * 37 + 13) % 89) + 4;
}

function conceptLabelFor(conceptKey: string | undefined, concepts: Concept[], fallback: string): string {
  if (!conceptKey) return fallback;
  return concepts.find((concept) => concept.key === conceptKey)?.displayLabel ?? fallback;
}

interface PreviewData {
  categories: string[];
  series: ChartSeriesMeta[];
  values: number[][];
}

function buildPreviewData(chartType: ChartType, mappingsByRole: Record<string, string>, concepts: Concept[]): PreviewData {
  if (chartType === 'heatMap') {
    const columnLabel = conceptLabelFor(mappingsByRole.x, concepts, 'Column');
    const rowLabel = conceptLabelFor(mappingsByRole.y, concepts, 'Row');
    const categories = SAMPLE_LABELS.map((_, index) => `${columnLabel} ${index + 1}`);
    const series: ChartSeriesMeta[] = [0, 1, 2].map((index) => ({ key: `row-${index}`, label: `${rowLabel} ${index + 1}` }));
    const values = series.map((_, rowIndex) => categories.map((_, columnIndex) => sampleValue(rowIndex * 5 + columnIndex)));
    return { categories, series, values };
  }

  const categoryLabel = conceptLabelFor(mappingsByRole.category ?? mappingsByRole.x, concepts, 'Category');
  const categories = SAMPLE_LABELS.map((_, index) => `${categoryLabel} ${index + 1}`);
  const seriesConceptKey = mappingsByRole.series;
  const series: ChartSeriesMeta[] = seriesConceptKey
    ? [0, 1].map((index) => ({ key: `series-${index}`, label: `${conceptLabelFor(seriesConceptKey, concepts, 'Series')} ${index + 1}` }))
    : [{ key: 'count', label: 'Count' }];
  const values = series.map((_, seriesIndex) => categories.map((_, categoryIndex) => sampleValue(seriesIndex * 7 + categoryIndex)));
  return { categories, series, values };
}

interface InsightBuilderModalProps {
  onClose: () => void;
  // Snapshot of the Articles result set this insight is built from — see this component's
  // own module comment (bottom of file) for the exact prop contract ArticlesPage's future
  // "Open in Insights" action should pass.
  sourceFilters: FilterPanelState;
  groupOptions: { id: string; name: string }[];
  defaultGroupId?: string | null | undefined;
  projectIds?: string[] | undefined;
  concepts: Concept[];
  existingInsight?: Insight | undefined;
  onSaved?: ((insight: Insight) => void) | undefined;
}

export default function InsightBuilderModal({
  onClose,
  sourceFilters,
  groupOptions,
  defaultGroupId,
  projectIds,
  concepts,
  existingInsight,
  onSaved,
}: InsightBuilderModalProps) {
  const queryClient = useQueryClient();
  const isEditing = existingInsight !== undefined;

  const [name, setName] = useState(existingInsight?.name ?? '');
  const [chartType, setChartType] = useState<ChartType>(existingInsight?.chartType ?? 'bar');
  const [groupId, setGroupId] = useState(existingInsight?.groupId ?? defaultGroupId ?? groupOptions[0]?.id ?? '');
  const [resolvedProjectIds] = useState<string[]>(existingInsight?.projectIds ?? projectIds ?? sourceFilters.projectIds);
  const [mappingsByRole, setMappingsByRole] = useState<Record<string, string>>(() =>
    existingInsight ? Object.fromEntries(existingInsight.config.fieldMappings.map((mapping) => [mapping.role, mapping.conceptKey])) : {},
  );
  const [armedConceptKey, setArmedConceptKey] = useState<string | null>(null);
  const [wordCloud, setWordCloud] = useState<WordCloudConfig>(existingInsight?.config.wordCloud ?? DEFAULT_WORD_CLOUD);
  const [exclusionInput, setExclusionInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const slots = CHART_FIELD_SLOTS[chartType];

  function assignRole(role: string, conceptKey: string) {
    setMappingsByRole((current) => ({ ...current, [role]: conceptKey }));
    setArmedConceptKey(null);
  }

  function clearRole(role: string) {
    setMappingsByRole((current) => {
      const next = { ...current };
      delete next[role];
      return next;
    });
  }

  function handleChartTypeSelect(type: ChartType) {
    if (type === chartType) return;
    setChartType(type);
    setMappingsByRole({});
    setArmedConceptKey(null);
  }

  function handleFieldClick(conceptKey: string) {
    setArmedConceptKey((current) => (current === conceptKey ? null : conceptKey));
  }

  function handleSlotClick(role: string) {
    if (armedConceptKey) {
      assignRole(role, armedConceptKey);
      return;
    }
    clearRole(role);
  }

  function handleSlotDrop(event: DragEvent<HTMLDivElement>, role: string) {
    event.preventDefault();
    const conceptKey = event.dataTransfer.getData('text/plain');
    if (conceptKey) {
      assignRole(role, conceptKey);
    }
  }

  function addExclusion() {
    const word = exclusionInput.trim().toLowerCase();
    if (!word || wordCloud.permanentExclusions.includes(word)) return;
    setWordCloud((current) => ({ ...current, permanentExclusions: [...current.permanentExclusions, word] }));
    setExclusionInput('');
  }

  function removeExclusion(word: string) {
    setWordCloud((current) => ({ ...current, permanentExclusions: current.permanentExclusions.filter((w) => w !== word) }));
  }

  const previewData = useMemo(() => buildPreviewData(chartType, mappingsByRole, concepts), [chartType, mappingsByRole, concepts]);
  const PreviewRenderer = resolveChartRenderer(chartType);

  const createMutation = useMutation({
    mutationFn: (input: CreateInsightInput) => createInsight(input),
    onSuccess: (insight) => {
      void queryClient.invalidateQueries({ queryKey: ['insights-list'] });
      toast.success('Insight created.');
      onSaved?.(insight);
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'Unable to create this insight.')),
  });

  const updateMutation = useMutation({
    mutationFn: (input: UpdateInsightInput) => updateInsight(existingInsight?.id ?? '', input),
    onSuccess: (insight) => {
      void queryClient.invalidateQueries({ queryKey: ['insights-list'] });
      toast.success('Insight updated.');
      onSaved?.(insight);
      onClose();
    },
    onError: (err: unknown) => setError(getApiErrorMessage(err, 'Unable to update this insight.')),
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required.');
      return;
    }
    if (!isEditing && !groupId) {
      setError('No group available — join a group before creating an insight.');
      return;
    }

    const fieldMappings: ChartFieldMapping[] = Object.entries(mappingsByRole).map(([role, conceptKey]) => ({ role, conceptKey }));
    if (chartType !== 'wordCloud' && !isRoleSatisfied(slots, fieldMappings)) {
      setError('Assign a field to every required slot.');
      return;
    }

    const config: InsightConfig = {
      fieldMappings: chartType === 'wordCloud' ? [] : fieldMappings,
      ...(chartType === 'wordCloud' ? { wordCloud } : {}),
    };

    if (isEditing) {
      updateMutation.mutate({ name: trimmedName, chartType, projectIds: resolvedProjectIds, config });
    } else {
      createMutation.mutate({
        groupId,
        projectIds: resolvedProjectIds,
        name: trimmedName,
        chartType,
        // FilterPanelState.sort is intentionally typed as plain `string` (see its own
        // comment in search-filters.ts, to avoid an import cycle with search-result.ts's
        // SearchSortOption), while createInsightSchema's zod-inferred input narrows it to
        // the SearchSortOption enum. Every real FilterPanelState in this app is produced by
        // UI that only ever assigns a genuine SearchSortOption value (see SORT_LABELS in
        // ArticlesPage), so this narrowing is safe at runtime even though the two
        // independently-declared shared-package shapes can't express it structurally.
        sourceFilters: sourceFilters as unknown as CreateInsightInput['sourceFilters'],
        config,
      });
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEditing ? 'Edit insight' : 'New insight'}
      size="full"
      scrollable
      testId="insight-builder-modal"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="insight-builder-form" loading={isSaving}>
            {isEditing ? 'Save changes' : 'Create insight'}
          </Button>
        </>
      }
    >
      <form id="insight-builder-form" onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="insight-name" className="block text-sm font-medium text-muted-foreground">
              Name
            </label>
            <Input
              id="insight-name"
              type="text"
              required
              autoFocus
              maxLength={INSIGHT_NAME_MAX_LENGTH}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {name.length}/{INSIGHT_NAME_MAX_LENGTH}
            </p>
          </div>

          <div>
            <label htmlFor="insight-group" className="block text-sm font-medium text-muted-foreground">
              Group
            </label>
            {isEditing ? (
              // An insight's group is fixed at creation (updateInsightSchema has no
              // groupId field) — shown read-only rather than as a disabled control that
              // implies it could be changed.
              <p className="mt-1 flex h-9 items-center text-sm text-foreground">
                {groupOptions.find((group) => group.id === groupId)?.name ?? groupId}
              </p>
            ) : (
              <Select
                id="insight-group"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                className="mt-1"
              >
                {groupOptions.length === 0 ? <option value="">No groups available</option> : null}
                {groupOptions.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-muted-foreground">Chart type</p>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {CHART_TYPES.map((type) => {
              const meta = CHART_TYPE_META[type];
              const Icon = meta.icon;
              const isSelected = type === chartType;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleChartTypeSelect(type)}
                  title={meta.description}
                  className="flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-xs transition-colors"
                  style={
                    isSelected
                      ? { borderColor: 'var(--primary)', backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }
                      : { borderColor: 'var(--border)', color: 'var(--muted-foreground)' }
                  }
                >
                  <Icon size={18} strokeWidth={1.75} />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        {chartType === 'wordCloud' ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">Word cloud settings</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="wc-max-words" className="block text-xs text-muted-foreground">
                  Max words
                </label>
                <Input
                  id="wc-max-words"
                  type="number"
                  min={1}
                  max={WORD_CLOUD_MAX_WORDS}
                  value={wordCloud.maxWords}
                  onChange={(event) =>
                    setWordCloud((current) => ({ ...current, maxWords: Number(event.target.value) || 1 }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="wc-min-occurrence" className="block text-xs text-muted-foreground">
                  Minimum occurrences
                </label>
                <Input
                  id="wc-min-occurrence"
                  type="number"
                  min={1}
                  value={wordCloud.minOccurrence}
                  onChange={(event) =>
                    setWordCloud((current) => ({ ...current, minOccurrence: Number(event.target.value) || 1 }))
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <label htmlFor="wc-exclusion" className="block text-xs text-muted-foreground">
                Excluded words
              </label>
              <div className="mt-1 flex gap-2">
                <Input
                  id="wc-exclusion"
                  type="text"
                  value={exclusionInput}
                  onChange={(event) => setExclusionInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addExclusion();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addExclusion} leftIcon={<Plus size={14} />}>
                  Add
                </Button>
              </div>
              {wordCloud.permanentExclusions.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {wordCloud.permanentExclusions.map((word) => (
                    <li
                      key={word}
                      className="flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs"
                      style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
                    >
                      {word}
                      <button type="button" onClick={() => removeExclusion(word)} aria-label={`Remove ${word}`}>
                        <X size={11} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium text-muted-foreground">Map fields</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Click an available field below, then click a slot to assign it — or drag a field onto a slot.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Available fields</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {concepts.length === 0 ? (
                    <li className="text-xs text-muted-foreground">No fields available for this project.</li>
                  ) : (
                    concepts.map((concept) => {
                      const isArmed = armedConceptKey === concept.key;
                      return (
                        <li key={concept.id}>
                          <button
                            type="button"
                            draggable
                            onDragStart={(event) => event.dataTransfer.setData('text/plain', concept.key)}
                            onClick={() => handleFieldClick(concept.key)}
                            className="cursor-grab rounded-sm border px-2.5 py-1 text-xs transition-colors active:cursor-grabbing"
                            style={
                              isArmed
                                ? { borderColor: 'var(--primary)', backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }
                                : { borderColor: 'var(--border)', color: 'var(--foreground)' }
                            }
                          >
                            {concept.displayLabel}
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Chart slots</p>
                <div className="mt-2 space-y-2">
                  {slots.map((slot) => {
                    const assignedKey = mappingsByRole[slot.role];
                    const assignedConcept = assignedKey ? concepts.find((concept) => concept.key === assignedKey) : undefined;
                    return (
                      <div
                        key={slot.role}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleSlotDrop(event, slot.role)}
                        onClick={() => handleSlotClick(slot.role)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleSlotClick(slot.role);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          'flex cursor-pointer items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-sm transition-colors',
                          assignedConcept || armedConceptKey ? 'border-primary' : 'border-border',
                          assignedConcept && 'bg-accent',
                        )}
                      >
                        <span className="text-muted-foreground">
                          {slot.label}
                          {slot.required ? <span className="text-destructive"> *</span> : null}
                        </span>
                        {assignedConcept ? (
                          <span className="flex items-center gap-1.5 font-medium text-primary">
                            <Check size={13} />
                            {assignedConcept.displayLabel}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Empty</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <p className="text-sm font-medium text-muted-foreground">Preview</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Sample preview — connects to real data once this insight is saved.</p>
          <div className="mt-2">
            {PreviewRenderer ? (
              <ErrorBoundary fallbackTitle="Preview unavailable">
                <PreviewRenderer categories={previewData.categories} series={previewData.series} values={previewData.values} />
              </ErrorBoundary>
            ) : (
              <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border py-10 text-center">
                <p className="text-sm font-medium text-foreground">Chart type coming online</p>
                <p className="text-xs text-muted-foreground">
                  {CHART_TYPE_META[chartType].label} isn&apos;t wired up yet — you can still save this insight.
                </p>
              </div>
            )}
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------
// Wiring contract for the "Open in Insights" action ArticlesPage doesn't yet call (Articles
// Core was a prior phase; this note is for whichever phase wires it up). Render this modal
// conditionally, same as every other modal in this codebase (no `isOpen` prop — mount/unmount
// it instead), passing:
//
//   <InsightBuilderModal
//     sourceFilters={filters}                                   // ArticlesPage's own `filters` state (FilterPanelState)
//     groupOptions={groupOptions.map((g) => ({ id: g.id, name: g.name }))} // same shape SaveQueryModal already receives
//     defaultGroupId={currentGroupId}                            // ArticlesPage's `user?.currentGroupId ?? null`
//     projectIds={filters.projectIds}                            // optional — defaults to sourceFilters.projectIds if omitted
//     concepts={concepts}                                        // ArticlesPage's own `concepts` (fetchConcepts(currentProjectId) result)
//     onClose={() => setIsInsightBuilderOpen(false)}
//     onSaved={(insight) => { toast.success(`Saved "${insight.name}".`); setIsInsightBuilderOpen(false); }}
//   />
//
// To edit an existing insight instead of creating one, pass `existingInsight={insight}` —
// groupId/sourceFilters then come from the insight itself and stay read-only in this modal
// (matches updateInsightSchema, which has no `groupId` field: an insight's group is fixed at
// creation).
// ---------------------------------------------------------------------------------------
