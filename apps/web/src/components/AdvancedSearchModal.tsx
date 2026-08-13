import { useEffect, useId, useState } from 'react';
import { Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';

import {
  ADVANCED_CONDITION_MODES,
  BOOLEAN_OPERATORS,
  DATE_FILTER_MODES,
  EMPTY_ADVANCED_SEARCH,
  TAXONOMY_MATCH_LOGICS,
  type AdvancedConditionMode,
  type AdvancedSearch,
  type AdvancedSearchCondition,
  type AdvancedSearchGroup,
  type BooleanOperator,
  type Concept,
  type DateFilterMode,
  type DateFilterValue,
  type FacetBucket,
  type TaxonomyMatchLogic,
} from '@content-insights/shared';

import { describeAdvancedSearch, describeDateFilter } from '../lib/advanced-search';
import Button from './ui/button';
import { Input, Select } from './ui/input';
import Modal from './ui/Modal';

// ---------------------------------------------------------------------------------------
// Rewritten for the Content Insights pivot to match packages/shared/src/types/search-
// filters.ts exactly: AdvancedSearch is a list of AdvancedSearchGroups, each a list of
// AdvancedSearchConditions, chained left-to-right via each item's own `operatorToNext`
// (not one global AND/OR) — see foldWithOperatorsMongo in apps/api's savedSearch.service.ts,
// which folds this exact same shape server-side. The old words-based (all/exact/any/none
// text boxes) + tags/contentType/dateRange design is gone; there is no `tags` or
// `contentType` field left anywhere in FilterPanelState for this modal to write into.
// ---------------------------------------------------------------------------------------

function generateId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createEmptyCondition(): AdvancedSearchCondition {
  return { id: generateId(), mode: 'text', values: [], matchLogic: 'any', operatorToNext: 'AND' };
}

function createEmptyGroup(): AdvancedSearchGroup {
  return { id: generateId(), conditions: [createEmptyCondition()], operatorToNext: 'AND' };
}

// Rebuilds a condition for a newly-picked mode rather than patching the old one in place —
// conceptKey/conceptKeys are optional fields under exactOptionalPropertyTypes, so an
// irrelevant one must be OMITTED, never assigned `undefined`.
function withMode(previous: AdvancedSearchCondition, mode: AdvancedConditionMode, concepts: Concept[]): AdvancedSearchCondition {
  const base = {
    id: previous.id,
    mode,
    values: [] as string[],
    matchLogic: previous.matchLogic,
    operatorToNext: previous.operatorToNext,
  };
  if (mode === 'taxonomy') {
    return concepts.length > 0 ? { ...base, conceptKey: concepts[0]!.key } : base;
  }
  if (mode === 'crossConcept') {
    return { ...base, conceptKeys: [] };
  }
  return base;
}

function isConditionUsable(condition: AdvancedSearchCondition): boolean {
  if (condition.values.length === 0) return false;
  if (condition.mode === 'taxonomy') return Boolean(condition.conceptKey);
  if (condition.mode === 'crossConcept') return Boolean(condition.conceptKeys && condition.conceptKeys.length > 0);
  return true;
}

// Drops still-empty/invalid rows on Apply (a half-filled row left over from editing should
// never reach the server) and derives `enabled` from whatever survives — there is no
// separate on/off switch in this UI, since "no usable groups" already means "no effect."
function buildAdvancedSearchPayload(groups: AdvancedSearchGroup[]): AdvancedSearch {
  const cleanedGroups = groups
    .map((group) => ({ ...group, conditions: group.conditions.filter(isConditionUsable) }))
    .filter((group) => group.conditions.length > 0);
  return { enabled: cleanedGroups.length > 0, groups: cleanedGroups };
}

const MODE_LABELS: Record<AdvancedConditionMode, string> = {
  text: 'Basic free text',
  taxonomy: 'Select a taxonomy + values',
  crossConcept: 'Search across concepts',
};
const MODE_DESCRIPTIONS: Record<AdvancedConditionMode, string> = {
  text: 'Search article title, summary, and body for these words or phrases.',
  taxonomy: 'Match values from one taxonomy.',
  crossConcept: 'Match a value across several taxonomies at once (spanning multiple concepts).',
};
const MATCH_LOGIC_LABELS: Record<TaxonomyMatchLogic, string> = {
  all: 'All',
  exact: 'Exact',
  any: 'Any',
  none: 'None',
};
const DATE_MODE_LABELS: Record<DateFilterMode, string> = {
  between: 'Between two dates',
  untilNow: 'From a date until now',
  lastNDays: 'In the last N days',
};

// -----------------------------------------------------------------------------------------
// ChipInput — shared free-text/value editor for every condition row regardless of mode.
// Suggestions (when supplied) come from live facet buckets, not a fixed enum — a taxonomy's
// values are open-ended, ingestion-derived data.
// -----------------------------------------------------------------------------------------

function ChipInput({
  values,
  onChange,
  placeholder,
  suggestions,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  suggestions?: string[] | undefined;
}) {
  const [draft, setDraft] = useState('');
  const listId = useId();

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setDraft('');
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  const remainingSuggestions = suggestions?.filter((s) => !values.includes(s)) ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-card p-1.5 focus-within:border-ring">
        {values.map((value) => (
          <span
            key={value}
            className="flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: 'var(--muted)', color: 'var(--foreground)' }}
          >
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              aria-label={`Remove ${value}`}
              className="hover:text-destructive"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          type="text"
          list={remainingSuggestions.length > 0 ? listId : undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          placeholder={values.length === 0 ? placeholder : 'Add another…'}
          data-testid="advanced-condition-value-input"
          className="min-w-[140px] flex-1 bg-transparent py-0.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      {remainingSuggestions.length > 0 ? (
        <datalist id={listId}>
          {remainingSuggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------------------
// OperatorToggle — the AND/OR picker rendered BETWEEN two adjacent items (two conditions, or
// two groups). Represents the earlier item's own operatorToNext, per the shared type's
// left-to-right chaining (there is deliberately no single "combine everything with" switch).
// -----------------------------------------------------------------------------------------

function OperatorToggle({ value, onChange }: { value: BooleanOperator; onChange: (value: BooleanOperator) => void }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="h-px flex-1 bg-border" />
      <div className="flex overflow-hidden rounded-full border border-border">
        {BOOLEAN_OPERATORS.map((operator) => (
          <button
            key={operator}
            type="button"
            onClick={() => onChange(operator)}
            className={`px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors ${
              operator === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            {operator}
          </button>
        ))}
      </div>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

// -----------------------------------------------------------------------------------------
// ConditionRow
// -----------------------------------------------------------------------------------------

interface ConditionRowProps {
  condition: AdvancedSearchCondition;
  onChange: (condition: AdvancedSearchCondition) => void;
  onRemove: () => void;
  concepts: Concept[];
  facets: Record<string, FacetBucket[]> | undefined;
}

function ConditionRow({ condition, onChange, onRemove, concepts, facets }: ConditionRowProps) {
  function patch(partial: Partial<AdvancedSearchCondition>) {
    onChange({ ...condition, ...partial });
  }

  const suggestionValues: string[] | undefined =
    condition.mode === 'taxonomy' && condition.conceptKey
      ? (facets?.[condition.conceptKey] ?? []).map((bucket) => bucket.key)
      : condition.mode === 'crossConcept' && condition.conceptKeys && condition.conceptKeys.length > 0
        ? Array.from(new Set(condition.conceptKeys.flatMap((key) => (facets?.[key] ?? []).map((bucket) => bucket.key))))
        : undefined;

  return (
    <div className="rounded-md border border-border bg-card p-3" data-testid="advanced-condition-row">
      <div className="flex items-start gap-2">
        <div className="grid flex-1 gap-2 sm:grid-cols-[200px_1fr]">
          <div>
            <Select
              value={condition.mode}
              onChange={(event) => onChange(withMode(condition, event.target.value as AdvancedConditionMode, concepts))}
              data-testid="advanced-condition-mode-select"
            >
              {ADVANCED_CONDITION_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {MODE_LABELS[mode]}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{MODE_DESCRIPTIONS[condition.mode]}</p>
          </div>

          <div className="space-y-2">
            {condition.mode === 'taxonomy' ? (
              concepts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No taxonomies are available to search.</p>
              ) : (
                <Select
                  value={condition.conceptKey ?? ''}
                  onChange={(event) => patch({ conceptKey: event.target.value })}
                  data-testid="advanced-condition-concept-select"
                >
                  {concepts.map((concept) => (
                    <option key={concept.key} value={concept.key}>
                      {concept.displayLabel || concept.name}
                    </option>
                  ))}
                </Select>
              )
            ) : null}

            {condition.mode === 'crossConcept' ? (
              concepts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No taxonomies are available to search.</p>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-md border border-border p-2">
                  {concepts.map((concept) => {
                    const checked = (condition.conceptKeys ?? []).includes(concept.key);
                    return (
                      <label
                        key={concept.key}
                        className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const current = condition.conceptKeys ?? [];
                            patch({
                              conceptKeys: checked
                                ? current.filter((key) => key !== concept.key)
                                : [...current, concept.key],
                            });
                          }}
                          className="h-4 w-4 rounded border-border accent-primary"
                        />
                        {concept.displayLabel || concept.name}
                      </label>
                    );
                  })}
                </div>
              )
            ) : null}

            {(condition.mode !== 'taxonomy' && condition.mode !== 'crossConcept') || concepts.length > 0 ? (
              <ChipInput
                values={condition.values}
                onChange={(values) => patch({ values })}
                placeholder={
                  condition.mode === 'text' ? 'Type a word or phrase, press Enter…' : 'Select or type a value, press Enter…'
                }
                suggestions={suggestionValues}
              />
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          title="Remove condition"
          aria-label="Remove condition"
          className="mt-1 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Match logic:</span>
        <div className="flex overflow-hidden rounded-md border border-border">
          {TAXONOMY_MATCH_LOGICS.map((logic) => (
            <button
              key={logic}
              type="button"
              onClick={() => patch({ matchLogic: logic })}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                logic === condition.matchLogic
                  ? 'bg-accent text-primary'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {MATCH_LOGIC_LABELS[logic]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------------------
// GroupCard
// -----------------------------------------------------------------------------------------

interface GroupCardProps {
  group: AdvancedSearchGroup;
  index: number;
  onChange: (group: AdvancedSearchGroup) => void;
  onRemove: () => void;
  concepts: Concept[];
  facets: Record<string, FacetBucket[]> | undefined;
}

function GroupCard({ group, index, onChange, onRemove, concepts, facets }: GroupCardProps) {
  function updateCondition(id: string, next: AdvancedSearchCondition) {
    onChange({ ...group, conditions: group.conditions.map((c) => (c.id === id ? next : c)) });
  }
  function removeCondition(id: string) {
    onChange({ ...group, conditions: group.conditions.filter((c) => c.id !== id) });
  }
  function addCondition() {
    onChange({ ...group, conditions: [...group.conditions, createEmptyCondition()] });
  }
  function setConditionOperator(id: string, operator: BooleanOperator) {
    onChange({
      ...group,
      conditions: group.conditions.map((c) => (c.id === id ? { ...c, operatorToNext: operator } : c)),
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Group {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
        >
          <Trash2 size={12} /> Remove group
        </button>
      </div>

      {group.conditions.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">This group has no conditions yet.</p>
      ) : (
        <div className="space-y-1">
          {group.conditions.map((condition, ci) => (
            <div key={condition.id}>
              <ConditionRow
                condition={condition}
                onChange={(next) => updateCondition(condition.id, next)}
                onRemove={() => removeCondition(condition.id)}
                concepts={concepts}
                facets={facets}
              />
              {ci < group.conditions.length - 1 ? (
                <OperatorToggle
                  value={condition.operatorToNext}
                  onChange={(operator) => setConditionOperator(condition.id, operator)}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addCondition}
        className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/90"
      >
        <Plus size={13} /> Add condition
      </button>
    </div>
  );
}

// -----------------------------------------------------------------------------------------
// DateRangeBlock
// -----------------------------------------------------------------------------------------

function toDateInputValue(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

function DateRangeBlock({
  value,
  onChange,
}: {
  value: DateFilterValue | null;
  onChange: (value: DateFilterValue | null) => void;
}) {
  const mode = value?.mode ?? 'between';

  function setMode(nextMode: DateFilterMode) {
    if (nextMode === 'between') {
      onChange({ mode: 'between', start: value?.start ?? null, end: value?.end ?? null });
    } else if (nextMode === 'untilNow') {
      onChange({ mode: 'untilNow', start: value?.start ?? null });
    } else {
      onChange({ mode: 'lastNDays', lastNDays: value?.lastNDays ?? 7 });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Date range</span>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear date range
          </button>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
        {DATE_FILTER_MODES.map((m) => (
          <label key={m} className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="radio"
              name="advanced-date-mode"
              checked={value !== null && mode === m}
              onChange={() => setMode(m)}
              className="h-4 w-4 border-border accent-primary"
            />
            {DATE_MODE_LABELS[m]}
          </label>
        ))}
      </div>

      {value ? (
        <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
          {mode === 'between' ? (
            <>
              <label className="block text-xs text-muted-foreground">
                From
                <Input
                  type="date"
                  value={toDateInputValue(value.start)}
                  onChange={(event) => onChange({ ...value, start: event.target.value || null })}
                  className="mt-1"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                To
                <Input
                  type="date"
                  value={toDateInputValue(value.end)}
                  onChange={(event) => onChange({ ...value, end: event.target.value || null })}
                  className="mt-1"
                />
              </label>
            </>
          ) : null}
          {mode === 'untilNow' ? (
            <label className="col-span-2 block text-xs text-muted-foreground">
              From
              <Input
                type="date"
                value={toDateInputValue(value.start)}
                onChange={(event) => onChange({ ...value, start: event.target.value || null })}
                className="mt-1"
              />
            </label>
          ) : null}
          {mode === 'lastNDays' ? (
            <label className="col-span-2 block text-xs text-muted-foreground">
              Number of days
              <Input
                type="number"
                min={1}
                value={value.lastNDays ?? ''}
                onChange={(event) =>
                  onChange({ ...value, lastNDays: event.target.value ? Number(event.target.value) : null })
                }
                className="mt-1"
              />
            </label>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No date range applied — pick an option above to add one.</p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------------------
// AdvancedSearchSummaryBanner — rendered by the parent page alongside its regular filter
// chips, whether or not the modal itself is currently open, whenever there is an active
// AdvancedSearch and/or date filter to describe in plain language.
// -----------------------------------------------------------------------------------------

export interface AdvancedSearchSummaryBannerProps {
  advancedSearch: AdvancedSearch;
  dateFilter: DateFilterValue | null;
  concepts?: Concept[];
  onEdit: () => void;
  onClear: () => void;
}

export function AdvancedSearchSummaryBanner({
  advancedSearch,
  dateFilter,
  concepts = [],
  onEdit,
  onClear,
}: AdvancedSearchSummaryBannerProps) {
  const criteria = describeAdvancedSearch(advancedSearch, concepts);
  const dateText = describeDateFilter(dateFilter);
  if (!criteria && !dateText) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-primary bg-accent px-4 py-2.5"
      data-testid="advanced-search-summary-banner"
    >
      <div className="flex min-w-0 items-start gap-2">
        <SlidersHorizontal size={15} className="mt-0.5 shrink-0 text-primary" />
        <p className="min-w-0 text-sm text-foreground">
          <span className="font-medium text-primary">Advanced search active — </span>
          {criteria}
          {criteria && dateText ? '; ' : ''}
          {dateText ? dateText.charAt(0).toUpperCase() + dateText.slice(1) : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs font-medium">
        <button type="button" onClick={onEdit} className="text-primary hover:text-primary/90">
          Edit
        </button>
        <button type="button" onClick={onClear} className="text-muted-foreground hover:text-destructive">
          Clear
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------------------
// AdvancedSearchModal
// -----------------------------------------------------------------------------------------

export interface AdvancedSearchApplyResult {
  advancedSearch: AdvancedSearch;
  dateFilter: DateFilterValue | null;
}

export interface AdvancedSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The FilterPanelState slice this modal edits — pass the parent's current values. */
  advancedSearch: AdvancedSearch;
  dateFilter: DateFilterValue | null;
  onApply: (result: AdvancedSearchApplyResult) => void;
  /** Taxonomies available to build taxonomy/crossConcept conditions against. */
  concepts?: Concept[];
  /** Live facet buckets (same shape POST /search/facets returns), used only as value suggestions. */
  facets?: Record<string, FacetBucket[]>;
}

export default function AdvancedSearchModal({
  isOpen,
  onClose,
  advancedSearch,
  dateFilter,
  onApply,
  concepts = [],
  facets,
}: AdvancedSearchModalProps) {
  const [groups, setGroups] = useState<AdvancedSearchGroup[]>(advancedSearch.groups);
  const [draftDateFilter, setDraftDateFilter] = useState<DateFilterValue | null>(dateFilter);

  // Re-seed from the last-applied state every time the modal opens — a close-without-Apply
  // (backdrop, X, Escape, Cancel) discards any in-progress edits. Seeds one empty group so
  // the builder isn't a blank canvas on first use; Apply prunes it away if left untouched.
  useEffect(() => {
    if (isOpen) {
      setGroups(advancedSearch.groups.length > 0 ? advancedSearch.groups : [createEmptyGroup()]);
      setDraftDateFilter(dateFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed on the open transition
  }, [isOpen]);

  function updateGroup(id: string, next: AdvancedSearchGroup) {
    setGroups((current) => current.map((g) => (g.id === id ? next : g)));
  }
  function removeGroup(id: string) {
    setGroups((current) => current.filter((g) => g.id !== id));
  }
  function addGroup() {
    setGroups((current) => [...current, createEmptyGroup()]);
  }
  function setGroupOperator(id: string, operator: BooleanOperator) {
    setGroups((current) => current.map((g) => (g.id === id ? { ...g, operatorToNext: operator } : g)));
  }

  function handleApply() {
    onApply({ advancedSearch: buildAdvancedSearchPayload(groups), dateFilter: draftDateFilter });
    onClose();
  }
  function handleClear() {
    onApply({ advancedSearch: EMPTY_ADVANCED_SEARCH, dateFilter: null });
    onClose();
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Advanced Search"
      description="Build grouped conditions, combined with AND/OR, plus an optional date range."
      size="full"
      scrollable
      className="max-w-[760px]"
      testId="advanced-search-modal"
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-muted-foreground hover:text-destructive" onClick={handleClear}>
            Clear advanced search
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleApply}>Apply</Button>
        </>
      }
    >
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No groups yet — add one to start building a query.</p>
      ) : (
        <div className="space-y-2">
          {groups.map((group, gi) => (
            <div key={group.id}>
              <GroupCard
                group={group}
                index={gi}
                onChange={(next) => updateGroup(group.id, next)}
                onRemove={() => removeGroup(group.id)}
                concepts={concepts}
                facets={facets}
              />
              {gi < groups.length - 1 ? (
                <OperatorToggle
                  value={group.operatorToNext}
                  onChange={(operator) => setGroupOperator(group.id, operator)}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addGroup}
        className="mt-4 flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/90"
      >
        <Plus size={14} /> Add group
      </button>

      <div className="mt-4">
        <DateRangeBlock value={draftDateFilter} onChange={setDraftDateFilter} />
      </div>
    </Modal>
  );
}
