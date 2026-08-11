import type {
  AdvancedSearch,
  AdvancedSearchCondition,
  AdvancedSearchGroup,
  Concept,
  DateFilterValue,
  TaxonomyMatchLogic,
} from '@content-insights/shared';

// Plain-language description of an AdvancedSearch/DateFilterValue — used by
// AdvancedSearchModal's own summary banner, and reusable anywhere else one needs to render
// as text (e.g. a saved search's row). Split out from AdvancedSearchModal.tsx itself so that
// component-only file doesn't also export plain functions (Fast Refresh only works when a
// file exports just components — react-refresh/only-export-components).
const MATCH_LOGIC_PHRASE: Record<TaxonomyMatchLogic, string> = {
  all: 'all of',
  exact: 'exactly',
  any: 'any of',
  none: 'none of',
};

function conceptLabel(key: string, concepts: Concept[]): string {
  const concept = concepts.find((c) => c.key === key);
  return concept ? concept.displayLabel || concept.name : key;
}

function describeCondition(condition: AdvancedSearchCondition, concepts: Concept[]): string {
  const subject =
    condition.mode === 'text'
      ? 'Text'
      : condition.mode === 'taxonomy'
        ? conceptLabel(condition.conceptKey ?? '', concepts)
        : (condition.conceptKeys ?? []).map((key) => conceptLabel(key, concepts)).join(' / ') || 'Concepts';
  const values = condition.values.length > 0 ? condition.values.map((v) => `"${v}"`).join(', ') : '(no values yet)';
  return `${subject} is ${MATCH_LOGIC_PHRASE[condition.matchLogic]} ${values}`;
}

function describeGroup(group: AdvancedSearchGroup, concepts: Concept[]): string {
  let text = group.conditions.length > 0 ? describeCondition(group.conditions[0]!, concepts) : '';
  for (let i = 1; i < group.conditions.length; i++) {
    text += ` ${group.conditions[i - 1]!.operatorToNext} ${describeCondition(group.conditions[i]!, concepts)}`;
  }
  return group.conditions.length > 1 ? `(${text})` : text;
}

export function describeAdvancedSearch(advancedSearch: AdvancedSearch, concepts: Concept[] = []): string | null {
  if (!advancedSearch.enabled || advancedSearch.groups.length === 0) return null;
  let text = describeGroup(advancedSearch.groups[0]!, concepts);
  for (let i = 1; i < advancedSearch.groups.length; i++) {
    text += ` ${advancedSearch.groups[i - 1]!.operatorToNext} ${describeGroup(advancedSearch.groups[i]!, concepts)}`;
  }
  return text;
}

export function describeDateFilter(dateFilter: DateFilterValue | null): string | null {
  if (!dateFilter) return null;
  switch (dateFilter.mode) {
    case 'between': {
      if (dateFilter.start && dateFilter.end) return `published between ${dateFilter.start} and ${dateFilter.end}`;
      if (dateFilter.start) return `published on or after ${dateFilter.start}`;
      if (dateFilter.end) return `published on or before ${dateFilter.end}`;
      return null;
    }
    case 'untilNow':
      return dateFilter.start ? `published from ${dateFilter.start} until now` : null;
    case 'lastNDays':
      return dateFilter.lastNDays
        ? `published in the last ${dateFilter.lastNDays} day${dateFilter.lastNDays === 1 ? '' : 's'}`
        : null;
  }
}
