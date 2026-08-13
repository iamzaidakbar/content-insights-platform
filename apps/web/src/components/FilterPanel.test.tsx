import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EMPTY_FILTER_PANEL_STATE,
  asOrgId,
  asProjectId,
  asUserTagId,
  asGroupId,
  asUserId,
  type FilterPanelState,
  type Project,
  type UserTag,
} from '@content-insights/shared';

import FilterPanel, { type FilterPanelConcept, type FilterPanelProps } from './FilterPanel';

const PROJECTS: Project[] = [
  {
    id: asProjectId('p1'),
    orgId: asOrgId('o1'),
    name: 'Alpha',
    description: '',
    createdAt: '',
    updatedAt: '',
  },
];

const USER_TAGS: UserTag[] = [
  {
    id: asUserTagId('t1'),
    orgId: asOrgId('o1'),
    name: 'compliance',
    ownerGroupId: asGroupId('g1'),
    ownerGroupName: 'Comms',
    isPrivate: false,
    isPublished: true,
    createdBy: asUserId('u1'),
    sharedWithGroups: [],
    articleCount: 3,
    createdAt: '',
    updatedAt: '',
  },
];

const CONCEPTS: FilterPanelConcept[] = [
  { key: 'sentiment', label: 'Sentiment', placement: 'soft', allowedValues: null },
  { key: 'region', label: 'Region', placement: 'hard', allowedValues: ['US', 'EU'] },
];

const FACETS = {
  sentiment: [
    { key: 'positive', count: 5 },
    { key: 'negative', count: 2 },
  ],
  // 'APAC' deliberately has no grant — must never render for a hard concept, no matter
  // what the facets response contains.
  region: [
    { key: 'US', count: 10 },
    { key: 'APAC', count: 1 },
  ],
};

type BaseProps = Omit<FilterPanelProps, 'value' | 'onChange'>;

const BASE_PROPS: BaseProps = {
  isOpen: true,
  onClose: vi.fn(),
  concepts: CONCEPTS,
  facets: FACETS,
  projects: PROJECTS,
  userTags: USER_TAGS,
  facetSortOrder: 'countDesc',
  hideZeroCountFacets: false,
};

/** Renders FilterPanel as a real controlled component, feeding each onChange back in as
 *  the next `value` — mirrors how the Articles page is expected to wire it up, and is
 *  required for any test that needs to observe the effect of more than one interaction. */
function ControlledFilterPanel({
  initialValue,
  onChange,
  ...rest
}: BaseProps & { initialValue: FilterPanelState; onChange?: (next: FilterPanelState) => void }) {
  const [value, setValue] = useState(initialValue);
  return (
    <FilterPanel
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

async function openSection(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: title }));
}

describe('FilterPanel', () => {
  // This project's vitest.config.ts doesn't set test.globals, so @testing-library/react's
  // automatic afterEach cleanup never registers (it only self-installs when it finds a
  // global `afterEach`) — without this, every `it` below would render on top of the
  // previous test's leftover DOM instead of a clean document.
  afterEach(cleanup);

  it('emits the full FilterPanelState — untouched fields pass through unchanged', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const customState: FilterPanelState = {
      ...EMPTY_FILTER_PANEL_STATE,
      query: 'earnings',
      sourceTypeTab: 'news',
      sort: 'relevance',
    };

    render(<FilterPanel {...BASE_PROPS} value={customState} onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Show only hidden articles' }));

    expect(onChange).toHaveBeenCalledWith({
      ...customState,
      hiddenArticles: 'onlyHidden',
    });
  });

  it('toggles the Hidden Articles mode', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterPanel {...BASE_PROPS} value={EMPTY_FILTER_PANEL_STATE} onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Show only hidden articles' }));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER_PANEL_STATE, hiddenArticles: 'onlyHidden' });
  });

  it('builds a "between" DateFilterValue from the two date pickers', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledFilterPanel {...BASE_PROPS} initialValue={EMPTY_FILTER_PANEL_STATE} onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Between dates' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-31' } });

    const last = onChange.mock.calls.at(-1)?.[0] as FilterPanelState;
    expect(last.dateFilter).toEqual({ mode: 'between', start: '2026-01-01', end: '2026-01-31', lastNDays: null });
  });

  it('never resolves "last N days" to absolute dates — stores the relative mode as-is', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledFilterPanel {...BASE_PROPS} initialValue={EMPTY_FILTER_PANEL_STATE} onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Last N days' }));
    await user.type(screen.getByLabelText('Number of days'), '7');

    const last = onChange.mock.calls.at(-1)?.[0] as FilterPanelState;
    expect(last.dateFilter).toEqual({ mode: 'lastNDays', start: null, end: null, lastNDays: 7 });
  });

  it('clears the date filter back to null via "Any time"', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const seeded: FilterPanelState = {
      ...EMPTY_FILTER_PANEL_STATE,
      dateFilter: { mode: 'untilNow', start: '2026-01-01', end: null, lastNDays: null },
    };
    render(<ControlledFilterPanel {...BASE_PROPS} initialValue={seeded} onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Any time' }));

    expect(onChange).toHaveBeenCalledWith({ ...seeded, dateFilter: null });
  });

  it('multi-selects Projects by id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterPanel {...BASE_PROPS} value={EMPTY_FILTER_PANEL_STATE} onChange={onChange} />);

    await openSection(user, 'Project');
    await user.click(screen.getByLabelText('Alpha'));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER_PANEL_STATE, projectIds: ['p1'] });
  });

  it('multi-selects User Tags by id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterPanel {...BASE_PROPS} value={EMPTY_FILTER_PANEL_STATE} onChange={onChange} />);

    await openSection(user, 'User Tags');
    await user.click(screen.getByLabelText('compliance'));

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER_PANEL_STATE, userTagIds: ['t1'] });
  });

  it('ORs selections within one concept and ANDs across different concepts', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledFilterPanel {...BASE_PROPS} initialValue={EMPTY_FILTER_PANEL_STATE} onChange={onChange} />);

    await openSection(user, 'Sentiment');
    await openSection(user, 'Region');

    // Concept checkboxes carry a trailing live count inside the same <label> (e.g.
    // "positive5"), so their accessible name isn't the bare value — match by prefix.
    await user.click(screen.getByLabelText(/^positive/));
    await user.click(screen.getByLabelText(/^US/));
    await user.click(screen.getByLabelText(/^negative/));

    const last = onChange.mock.calls.at(-1)?.[0] as FilterPanelState;
    expect(last.taxonomyValues).toEqual({ sentiment: ['positive', 'negative'], region: ['US'] });
  });

  it('restricts a hard concept to its granted allowedValues, ignoring any other facet bucket', async () => {
    const user = userEvent.setup();
    render(<FilterPanel {...BASE_PROPS} value={EMPTY_FILTER_PANEL_STATE} onChange={vi.fn()} />);

    await openSection(user, 'Region');

    expect(screen.getByLabelText(/^US/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^EU/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^APAC/)).not.toBeInTheDocument();
  });

  it('shows a denial message instead of checkboxes when a hard concept has no granted values', async () => {
    const user = userEvent.setup();
    const deniedConcepts: FilterPanelConcept[] = [
      { key: 'region', label: 'Region', placement: 'hard', allowedValues: [], denialNote: 'Ask your admin for access.' },
    ];
    render(
      <FilterPanel {...BASE_PROPS} concepts={deniedConcepts} value={EMPTY_FILTER_PANEL_STATE} onChange={vi.fn()} />,
    );

    await openSection(user, 'Region');

    expect(screen.getByText('Ask your admin for access.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('Select All picks every visible value; Clear All empties that concept only', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledFilterPanel {...BASE_PROPS} initialValue={EMPTY_FILTER_PANEL_STATE} onChange={onChange} />);

    await openSection(user, 'Sentiment');
    await openSection(user, 'Region');
    await user.click(screen.getByLabelText(/^US/));

    const sentimentSelectAll = screen.getAllByRole('button', { name: 'Select All' })[0];
    await user.click(sentimentSelectAll as HTMLElement);

    let last = onChange.mock.calls.at(-1)?.[0] as FilterPanelState;
    expect(last.taxonomyValues.sentiment).toEqual(expect.arrayContaining(['positive', 'negative']));
    expect(last.taxonomyValues.region).toEqual(['US']); // unaffected by Sentiment's Select All

    const sentimentClearAll = screen.getAllByRole('button', { name: 'Clear All' })[0];
    await user.click(sentimentClearAll as HTMLElement);

    last = onChange.mock.calls.at(-1)?.[0] as FilterPanelState;
    expect(last.taxonomyValues.sentiment).toEqual([]);
    expect(last.taxonomyValues.region).toEqual(['US']);
  });

  it('hides zero-count values when hideZeroCountFacets is set, but keeps a selected zero-count value visible', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FilterPanel {...BASE_PROPS} hideZeroCountFacets value={EMPTY_FILTER_PANEL_STATE} onChange={vi.fn()} />,
    );

    await openSection(user, 'Region');
    expect(screen.getByLabelText(/^US/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^EU/)).not.toBeInTheDocument(); // EU has 0 count and isn't selected

    rerender(
      <FilterPanel
        {...BASE_PROPS}
        hideZeroCountFacets
        value={{ ...EMPTY_FILTER_PANEL_STATE, taxonomyValues: { region: ['EU'] } }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/^EU/)).toBeInTheDocument(); // now selected, so it stays visible despite 0 count
  });

  it('reorders a concept section when its per-session sort toggle changes', async () => {
    const user = userEvent.setup();
    render(
      <FilterPanel {...BASE_PROPS} facetSortOrder="countDesc" value={EMPTY_FILTER_PANEL_STATE} onChange={vi.fn()} />,
    );

    await openSection(user, 'Sentiment');

    const initialOrder = screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent);
    expect(initialOrder).toEqual(['positive5', 'negative2']); // countDesc default: 5 before 2

    await user.selectOptions(screen.getByLabelText('Sort Sentiment'), 'az');

    const azOrder = screen.getAllByRole('checkbox').map((box) => box.closest('label')?.textContent);
    expect(azOrder).toEqual(['negative2', 'positive5']); // alphabetical: negative before positive
  });

  it('column variant is a complementary landmark without a dialog or Done button', () => {
    render(
      <FilterPanel
        {...BASE_PROPS}
        variant="column"
        value={EMPTY_FILTER_PANEL_STATE}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('complementary', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('column Clear All still emits a reset of the fields this panel owns', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const seeded: FilterPanelState = {
      ...EMPTY_FILTER_PANEL_STATE,
      query: 'keep me',
      hiddenArticles: 'onlyHidden',
      projectIds: ['p1'],
    };
    render(<FilterPanel {...BASE_PROPS} variant="column" value={seeded} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Clear All' }));

    expect(onChange).toHaveBeenCalledWith({
      ...seeded,
      hiddenArticles: EMPTY_FILTER_PANEL_STATE.hiddenArticles,
      dateFilter: EMPTY_FILTER_PANEL_STATE.dateFilter,
      projectIds: EMPTY_FILTER_PANEL_STATE.projectIds,
      taxonomyValues: {},
      userTagIds: EMPTY_FILTER_PANEL_STATE.userTagIds,
    });
  });
});
