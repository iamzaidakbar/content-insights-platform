import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

import {
  DATE_FILTER_MODES,
  EMPTY_FILTER_PANEL_STATE,
  FACET_SORT_ORDERS,
  HIDDEN_ARTICLES_MODES,
  type ConceptPlacement,
  type DateFilterMode,
  type DateFilterValue,
  type FacetBucket,
  type FacetSortOrder,
  type FilterPanelState,
  type HiddenArticlesMode,
  type Project,
  type UserTag,
} from '@content-insights/shared';

import { countsByUserTagId } from '../lib/search-api';
import Button from './ui/button';
import { Input } from './ui/input';

// FilterPanel is a pure controlled component: it owns no filter state of its own (only
// ephemeral, non-filter UI state — collapsed sections, the per-session facet sort-order
// override, the user-tag search box). Every actual selection lives in `value`
// (FilterPanelState) and every change is emitted immediately via `onChange(next)` — there
// is no internal draft + "Apply" gate. This is deliberate: faceted filtering only feels
// right when checking a box instantly narrows the other sections' live counts, so the
// parent (Articles page) is expected to key its POST /search and POST /search/facets
// queries off `value` directly and refetch on every change. FilterPanel itself never
// fetches anything.
//
// FilterPanel does NOT own query text, sourceTypeTab, advancedSearch, or sort — those live
// elsewhere in the Articles page UI (search box / tabs / Advanced Search modal / sort
// dropdown) — but every onChange call still carries the FULL FilterPanelState (this
// component's own edits merged over whatever `value` already held for those fields), so the
// parent can treat `onChange` as its single source of truth for "run the search now."

export interface FilterPanelConcept {
  /** Concept.key — the taxonomyValues record key and the facets response key. */
  key: string;
  /** Concept.displayLabel — this section's heading. */
  label: string;
  /** 'hard' sections restrict the selectable universe to allowedValues (below); 'soft'
   *  sections are open — their universe is whatever the live facet buckets return (plus
   *  any already-selected value, so a pick never silently vanishes from the list). */
  placement: ConceptPlacement;
  /** Non-null only when placement is 'hard': the group's HardFilterGrant.allowedValues.
   *  The backend enforces this ceiling independently — showing only these checkboxes is a
   *  UX courtesy (don't offer values the user could never actually select), not itself the
   *  security boundary. An empty array means the group has no grant for this concept at
   *  all — rendered as a denial message instead of an empty checkbox list. */
  allowedValues: string[] | null;
  /** Admin's explanation for an empty hard-filter grant (HardFilterGrant.denialNote). */
  denialNote?: string | null;
}

export interface FilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** `column` is an in-flow complementary landmark; `drawer` is the mobile overlay. */
  variant?: 'drawer' | 'column';
  /** The full, currently-active filter state (owned by the parent). */
  value: FilterPanelState;
  /** Called with the complete next FilterPanelState on every edit — see the module
   *  comment above for why this fires immediately rather than behind an Apply button. */
  onChange: (next: FilterPanelState) => void;
  /** One entry per concept section to render, already restricted to the current group's
   *  data access and pre-ordered (soft concepts by their admin-configured
   *  SoftFilterConceptGrant.order; hard concepts included too) — FilterPanel renders them
   *  in exactly the array order given. */
  concepts: FilterPanelConcept[];
  /** Live bucket counts from POST /search/facets (FacetsResponse.facets), keyed by
   *  Concept.key or USER_TAGS_FACET_KEY. Undefined while the facets request hasn't resolved yet. */
  facets?: Record<string, FacetBucket[]> | undefined;
  /** True while POST /search/facets is in flight — soft sections show a loading line
   *  instead of a misleading "No values." empty state. */
  facetsLoading?: boolean | undefined;
  /** The caller's accessible projects, for the Project system filter. */
  projects: Project[];
  /** Every user tag visible to the caller, for the User Tags system filter. */
  userTags: UserTag[];
  /** UserSettings.facetSortOrder — the default sort order for every concept section,
   *  until a user overrides one for this session (see the module comment: overrides are
   *  local-only and are never written back to UserSettings by this component). */
  facetSortOrder: FacetSortOrder;
  /** UserSettings.hideZeroCountFacets — when true, zero-count values are hidden from
   *  every concept section unless already selected. */
  hideZeroCountFacets: boolean;
}

const HIDDEN_ARTICLES_LABELS: Record<HiddenArticlesMode, string> = {
  exclude: 'Exclude hidden articles',
  onlyHidden: 'Show only hidden articles',
};

const FACET_SORT_LABELS: Record<FacetSortOrder, string> = {
  az: 'A–Z',
  za: 'Z–A',
  countAsc: 'Count: Low–High',
  countDesc: 'Count: High–Low',
};

// 'none' is a UI-only concept: DateFilterMode has no "no filter" member of its own —
// FilterPanelState.dateFilter's nullability IS "no filter" — so this local union adds the
// one extra radio option a real DateFilterMode can't express.
type DateFilterUiMode = 'none' | DateFilterMode;
const DATE_FILTER_UI_MODES: DateFilterUiMode[] = ['none', ...DATE_FILTER_MODES];
const DATE_FILTER_UI_LABELS: Record<DateFilterUiMode, string> = {
  none: 'Any time',
  between: 'Between dates',
  untilNow: 'From a date until now',
  lastNDays: 'Last N days',
};

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border py-3 last:border-b-0">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between text-left text-sm font-medium text-foreground"
      >
        {title}
        <ChevronDown
          size={16}
          className={`text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen ? <div className="mt-3 min-w-0">{children}</div> : null}
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
  trailing,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  trailing?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 py-1 text-sm text-muted-foreground">
      <span className="flex min-w-0 items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-border accent-primary"
        />
        <span className="truncate">{label}</span>
      </span>
      {trailing}
    </label>
  );
}

function toggleInArray(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function DateFilterFields({
  value,
  onChange,
}: {
  value: DateFilterValue | null;
  onChange: (next: DateFilterValue | null) => void;
}) {
  const mode: DateFilterUiMode = value?.mode ?? 'none';

  function selectMode(nextMode: DateFilterUiMode) {
    if (nextMode === 'none') {
      onChange(null);
      return;
    }
    if (value?.mode === nextMode) {
      return;
    }
    onChange({ mode: nextMode, start: null, end: null, lastNDays: null });
  }

  function patch(partial: Partial<DateFilterValue>) {
    if (!value) return;
    onChange({ ...value, ...partial });
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {DATE_FILTER_UI_MODES.map((uiMode) => (
          <label
            key={uiMode}
            className="flex cursor-pointer items-center gap-2 py-1 text-sm text-muted-foreground"
          >
            <input
              type="radio"
              name="filter-date-mode"
              checked={mode === uiMode}
              onChange={() => selectMode(uiMode)}
              className="h-4 w-4 border-border accent-primary"
            />
            {DATE_FILTER_UI_LABELS[uiMode]}
          </label>
        ))}
      </div>

      {mode === 'between' ? (
        <div className="grid grid-cols-2 gap-2 pl-6">
          <label className="block text-xs text-muted-foreground">
            From
            <Input
              type="date"
              value={value?.start ?? ''}
              onChange={(event) => patch({ start: event.target.value || null })}
              className="mt-1"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            To
            <Input
              type="date"
              value={value?.end ?? ''}
              onChange={(event) => patch({ end: event.target.value || null })}
              className="mt-1"
            />
          </label>
        </div>
      ) : null}

      {mode === 'untilNow' ? (
        <label className="block pl-6 text-xs text-muted-foreground">
          From
          <Input
            type="date"
            value={value?.start ?? ''}
            onChange={(event) => patch({ start: event.target.value || null })}
            className="mt-1"
          />
        </label>
      ) : null}

      {mode === 'lastNDays' ? (
        <label className="block pl-6 text-xs text-muted-foreground">
          Number of days
          <Input
            type="number"
            min={1}
            step={1}
            value={value?.lastNDays ?? ''}
            onChange={(event) => {
              const raw = event.target.value;
              const parsed = raw === '' ? null : Math.max(1, Math.trunc(Number(raw)));
              patch({ lastNDays: parsed !== null && Number.isFinite(parsed) ? parsed : null });
            }}
            className="mt-1"
          />
        </label>
      ) : null}
    </div>
  );
}

interface ConceptOption {
  value: string;
  count: number;
}

// The selectable universe for a section: a hard concept is always exactly its granted
// allowedValues (every one of them, so the user can see — and clear — a value even with a
// zero count); a soft concept is whatever the live facet buckets returned, unioned with
// anything already selected so a pick never disappears just because it dropped to a
// zero-count bucket the backend didn't bother returning.
function buildConceptOptions(
  concept: FilterPanelConcept,
  buckets: FacetBucket[] | undefined,
  selected: string[],
): ConceptOption[] {
  const countByValue = new Map((buckets ?? []).map((bucket) => [bucket.key, bucket.count]));
  const universe = concept.allowedValues
    ? concept.allowedValues
    : Array.from(new Set([...(buckets ?? []).map((bucket) => bucket.key), ...selected]));
  return universe.map((optionValue) => ({ value: optionValue, count: countByValue.get(optionValue) ?? 0 }));
}

function sortConceptOptions(options: ConceptOption[], order: FacetSortOrder): ConceptOption[] {
  const sorted = [...options];
  switch (order) {
    case 'az':
      sorted.sort((a, b) => a.value.localeCompare(b.value));
      break;
    case 'za':
      sorted.sort((a, b) => b.value.localeCompare(a.value));
      break;
    case 'countAsc':
      sorted.sort((a, b) => a.count - b.count);
      break;
    case 'countDesc':
      sorted.sort((a, b) => b.count - a.count);
      break;
  }
  return sorted;
}

function ConceptFilterSection({
  concept,
  selected,
  buckets,
  sortOrder,
  onSortOrderChange,
  hideZeroCountFacets,
  facetsLoading,
  onToggleValue,
  onSelectAll,
  onClearAll,
}: {
  concept: FilterPanelConcept;
  selected: string[];
  buckets: FacetBucket[] | undefined;
  sortOrder: FacetSortOrder;
  onSortOrderChange: (order: FacetSortOrder) => void;
  hideZeroCountFacets: boolean;
  facetsLoading: boolean;
  onToggleValue: (value: string) => void;
  onSelectAll: (values: string[]) => void;
  onClearAll: () => void;
}) {
  const isDenied = concept.placement === 'hard' && (concept.allowedValues?.length ?? 0) === 0;

  const visibleOptions = isDenied
    ? []
    : sortConceptOptions(
        buildConceptOptions(concept, buckets, selected).filter(
          (option) => !hideZeroCountFacets || option.count > 0 || selected.includes(option.value),
        ),
        sortOrder,
      );

  return (
    <CollapsibleSection title={concept.label} defaultOpen={false}>
      {isDenied ? (
        <p className="text-xs text-muted-foreground">
          {concept.denialNote || 'Your group has no access to this filter.'}
        </p>
      ) : (
        <>
          {visibleOptions.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">
              {facetsLoading ? 'Loading values…' : 'No values.'}
            </p>
          ) : (
            <>
              <div className="mb-2 flex min-w-0 flex-col gap-1.5">
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => onSelectAll(visibleOptions.map((option) => option.value))}
                    className="whitespace-nowrap text-primary hover:underline"
                  >
                    Select All
                  </button>
                  <span className="text-muted-foreground" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={onClearAll}
                    className="whitespace-nowrap text-primary hover:underline"
                  >
                    Clear All
                  </button>
                </div>
                <select
                  aria-label={`Sort ${concept.label}`}
                  value={sortOrder}
                  onChange={(event) => onSortOrderChange(event.target.value as FacetSortOrder)}
                  className="h-7 w-full min-w-0 max-w-full rounded-md border border-border bg-card py-1 pl-2 pr-7 text-xs text-muted-foreground outline-none focus-visible:border-ring"
                >
                  {FACET_SORT_ORDERS.map((order) => (
                    <option key={order} value={order}>
                      {FACET_SORT_LABELS[order]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="cip-scroll max-h-56 min-w-0 space-y-0.5">
                {visibleOptions.map((option) => (
                  <Checkbox
                    key={option.value}
                    checked={selected.includes(option.value)}
                    onChange={() => onToggleValue(option.value)}
                    label={option.value}
                    trailing={<span className="shrink-0 text-xs text-muted-foreground">{option.count}</span>}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}

export default function FilterPanel({
  isOpen,
  onClose,
  variant = 'drawer',
  value,
  onChange,
  concepts,
  facets,
  projects,
  userTags,
  facetSortOrder,
  hideZeroCountFacets,
  facetsLoading = false,
}: FilterPanelProps) {
  const [userTagQuery, setUserTagQuery] = useState('');
  // Per-concept sort-order override for this session only — seeded lazily from
  // `facetSortOrder` (the user's persisted default) the first time a section's dropdown is
  // touched; never written back to UserSettings by this component.
  const [sortOverrides, setSortOverrides] = useState<Record<string, FacetSortOrder>>({});
  const isColumn = variant === 'column';

  useEffect(() => {
    if (!isOpen || isColumn) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isColumn, onClose]);

  function patch(partial: Partial<FilterPanelState>) {
    onChange({ ...value, ...partial });
  }

  function toggleProject(id: string) {
    patch({ projectIds: toggleInArray(value.projectIds, id) });
  }

  function toggleUserTag(id: string) {
    patch({ userTagIds: toggleInArray(value.userTagIds, id) });
  }

  function toggleTaxonomyValue(conceptKey: string, optionValue: string) {
    const current = value.taxonomyValues[conceptKey] ?? [];
    patch({ taxonomyValues: { ...value.taxonomyValues, [conceptKey]: toggleInArray(current, optionValue) } });
  }

  function selectAllForConcept(conceptKey: string, values: string[]) {
    patch({ taxonomyValues: { ...value.taxonomyValues, [conceptKey]: values } });
  }

  function clearConcept(conceptKey: string) {
    patch({ taxonomyValues: { ...value.taxonomyValues, [conceptKey]: [] } });
  }

  // Resets only the sections this panel owns (hidden/date/project/taxonomy/userTags) —
  // query, sourceTypeTab, advancedSearch, and sort belong to other UI and are left as-is.
  function handleClearAll() {
    onChange({
      ...value,
      hiddenArticles: EMPTY_FILTER_PANEL_STATE.hiddenArticles,
      dateFilter: EMPTY_FILTER_PANEL_STATE.dateFilter,
      projectIds: EMPTY_FILTER_PANEL_STATE.projectIds,
      taxonomyValues: {},
      userTagIds: EMPTY_FILTER_PANEL_STATE.userTagIds,
    });
  }

  const userTagCountById = countsByUserTagId(facets);
  const visibleUserTags = (
    userTagQuery.trim()
      ? userTags.filter((tag) => tag.name.toLowerCase().includes(userTagQuery.trim().toLowerCase()))
      : userTags
  ).filter(
    (tag) =>
      !hideZeroCountFacets ||
      (userTagCountById[tag.id] ?? 0) > 0 ||
      value.userTagIds.includes(tag.id),
  );

  const sections = (
    <>
      <CollapsibleSection title="Hidden Articles">
        <div className="space-y-1">
          {HIDDEN_ARTICLES_MODES.map((mode) => (
            <label
              key={mode}
              className="flex cursor-pointer items-center gap-2 py-1 text-sm text-muted-foreground"
            >
              <input
                type="radio"
                name="filter-hidden-articles"
                checked={value.hiddenArticles === mode}
                onChange={() => patch({ hiddenArticles: mode })}
                className="h-4 w-4 border-border accent-primary"
              />
              {HIDDEN_ARTICLES_LABELS[mode]}
            </label>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Date">
        <DateFilterFields value={value.dateFilter} onChange={(next) => patch({ dateFilter: next })} />
      </CollapsibleSection>

      <CollapsibleSection title="Project" defaultOpen={false}>
        {projects.length === 0 ? (
          <p className="text-xs text-muted-foreground">No accessible projects.</p>
        ) : (
          <div className="space-y-0.5">
            {projects.map((project) => (
              <Checkbox
                key={project.id}
                checked={value.projectIds.includes(project.id)}
                onChange={() => toggleProject(project.id)}
                label={project.name}
              />
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          No selection searches every project you can access.
        </p>
      </CollapsibleSection>

      <CollapsibleSection title="User Tags" defaultOpen={false}>
        <div className="relative mb-2">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={userTagQuery}
            onChange={(event) => setUserTagQuery(event.target.value)}
            placeholder="Search tags…"
            className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-2 text-sm text-foreground outline-none focus-visible:border-ring"
          />
        </div>
        {visibleUserTags.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">No matching tags.</p>
        ) : (
          <div className="cip-scroll max-h-48 space-y-0.5">
            {visibleUserTags.map((tag) => (
              <Checkbox
                key={tag.id}
                checked={value.userTagIds.includes(tag.id)}
                onChange={() => toggleUserTag(tag.id)}
                label={tag.name}
                trailing={
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {userTagCountById[tag.id] ?? 0}
                  </span>
                }
              />
            ))}
          </div>
        )}
      </CollapsibleSection>

      {concepts.map((concept) => (
        <ConceptFilterSection
          key={concept.key}
          concept={concept}
          selected={value.taxonomyValues[concept.key] ?? []}
          buckets={facets?.[concept.key]}
          sortOrder={sortOverrides[concept.key] ?? facetSortOrder}
          onSortOrderChange={(order) =>
            setSortOverrides((current) => ({ ...current, [concept.key]: order }))
          }
          hideZeroCountFacets={hideZeroCountFacets}
          facetsLoading={facetsLoading}
          onToggleValue={(optionValue) => toggleTaxonomyValue(concept.key, optionValue)}
          onSelectAll={(values) => selectAllForConcept(concept.key, values)}
          onClearAll={() => clearConcept(concept.key)}
        />
      ))}
    </>
  );

  const header = (
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <h2 className="text-sm font-semibold text-foreground">Filters</h2>
      {isColumn ? null : (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className="rounded-[6px] p-1 text-muted-foreground hover:bg-accent"
        >
          <X size={18} />
        </button>
      )}
    </div>
  );

  const footer = (
    <div className="flex items-center gap-2 border-t border-border px-4 py-3">
      <Button type="button" variant="outline" onClick={handleClearAll} className={isColumn ? 'w-full' : 'flex-1'}>
        Clear All
      </Button>
      {isColumn ? null : (
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      )}
    </div>
  );

  if (isColumn) {
    if (!isOpen) {
      return null;
    }
    return (
      <aside
        role="complementary"
        aria-label="Filters"
        className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-card"
      >
        {header}
        <div className="cip-scroll min-h-0 flex-1 px-4">{sections}</div>
        {footer}
      </aside>
    );
  }

  return (
    <>
      {isOpen ? (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden="true" />
      ) : null}
      <div
        role="dialog"
        aria-label="Filters"
        aria-hidden={!isOpen}
        className={`fixed inset-y-0 left-0 z-50 w-80 transform border-r border-border bg-card shadow-2xl transition-transform duration-200 motion-reduce:transition-none ${
          isOpen ? 'translate-x-0' : '-translate-x-full motion-reduce:hidden'
        }`}
      >
        <div className="flex h-full flex-col">
          {header}
          <div className="cip-scroll flex-1 px-4">{sections}</div>
          {footer}
        </div>
      </div>
    </>
  );
}
