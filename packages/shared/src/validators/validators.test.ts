import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTIONS,
  articleBulkRequestSchema,
  assignUserRoleSchema,
  createInsightSchema,
  createRoleSchema,
  createUserTagSchema,
  dateFilterValueSchema,
  EMPTY_FILTER_PANEL_STATE,
  parseArticlesUrlState,
  searchRequestSchema,
  serializeArticlesUrlState,
  setChannelSchema,
  setUserActiveSchema,
  createArticleNoteSchema,
} from '../index.js';
import type { FilterPanelState } from '../index.js';

const validFilters: FilterPanelState = {
  query: 'inflation',
  sourceTypeTab: 'all',
  hiddenArticles: 'exclude',
  dateFilter: null,
  projectIds: [],
  taxonomyValues: {},
  userTagIds: [],
  advancedSearch: { enabled: false, groups: [] },
  sort: 'date_desc',
};

describe('createRoleSchema', () => {
  it('accepts a role built from the new permission catalog', () => {
    const parsed = createRoleSchema.parse({
      name: 'Regional Analyst',
      permissions: ['articles:read', 'saved-searches:manage'],
    });
    expect(parsed.permissions).toEqual(['articles:read', 'saved-searches:manage']);
  });

  it('rejects a permission not in the catalog', () => {
    expect(() =>
      createRoleSchema.parse({
        name: 'Legacy Role',
        permissions: ['documents:read'],
      }),
    ).toThrow();
  });
});

describe('assignUserRoleSchema', () => {
  it('accepts a null groupId as the "All" (global) scope', () => {
    const parsed = assignUserRoleSchema.parse({ roleId: 'role1', groupId: null });
    expect(parsed.groupId).toBeNull();
  });

  it('rejects a missing roleId', () => {
    expect(() => assignUserRoleSchema.parse({ groupId: 'group1' })).toThrow();
  });
});

describe('articleBulkRequestSchema', () => {
  it('requires tagIds for addTags', () => {
    expect(() =>
      articleBulkRequestSchema.parse({
        action: 'addTags',
        articleIds: ['507f1f77bcf86cd799439011'],
      }),
    ).toThrow();
  });

  it('accepts a hide bulk request', () => {
    const parsed = articleBulkRequestSchema.parse({
      action: 'hide',
      articleIds: ['507f1f77bcf86cd799439011'],
    });
    expect(parsed.action).toBe('hide');
  });
});

describe('searchRequestSchema', () => {
  it('accepts a full filter panel state with pagination', () => {
    const parsed = searchRequestSchema.parse({ filters: validFilters, page: 1, size: 20 });
    expect(parsed.filters.sourceTypeTab).toBe('all');
    expect(parsed.page).toBe(1);
  });

  it('rejects a page below 1', () => {
    expect(() => searchRequestSchema.parse({ filters: validFilters, page: 0, size: 20 })).toThrow();
  });
});

describe('dateFilterValueSchema', () => {
  it('requires lastNDays when mode is lastNDays', () => {
    expect(() => dateFilterValueSchema.parse({ mode: 'lastNDays' })).toThrow();
  });

  it('accepts a between range', () => {
    const parsed = dateFilterValueSchema.parse({
      mode: 'between',
      start: '2026-01-01',
      end: '2026-02-01',
    });
    expect(parsed.end).toBe('2026-02-01');
  });
});

describe('createUserTagSchema', () => {
  it('rejects a name longer than USER_TAG_NAME_MAX_LENGTH', () => {
    expect(() => createUserTagSchema.parse({ name: 'a'.repeat(26) })).toThrow();
  });

  it('accepts a name at the length limit', () => {
    const parsed = createUserTagSchema.parse({ name: 'a'.repeat(25) });
    expect(parsed.name).toHaveLength(25);
  });
});

describe('createInsightSchema', () => {
  it('rejects a wordCloud config over WORD_CLOUD_MAX_WORDS', () => {
    expect(() =>
      createInsightSchema.parse({
        groupId: 'group1',
        name: 'Top Terms',
        chartType: 'wordCloud',
        sourceFilters: validFilters,
        config: {
          fieldMappings: [],
          wordCloud: {
            maxWords: 301,
            minOccurrence: 1,
            permanentExclusions: [],
            temporaryExclusions: [],
          },
        },
      }),
    ).toThrow();
  });

  it('rejects a name longer than INSIGHT_NAME_MAX_LENGTH', () => {
    expect(() =>
      createInsightSchema.parse({
        groupId: 'group1',
        name: 'a'.repeat(31),
        chartType: 'bar',
        sourceFilters: validFilters,
        config: { fieldMappings: [] },
      }),
    ).toThrow();
  });
});

describe('setUserActiveSchema', () => {
  it('accepts isActive true or false', () => {
    expect(setUserActiveSchema.parse({ isActive: true }).isActive).toBe(true);
    expect(setUserActiveSchema.parse({ isActive: false }).isActive).toBe(false);
  });

  it('accepts an optional reason', () => {
    expect(setUserActiveSchema.parse({ isActive: false, reason: 'left the company' }).reason).toBe(
      'left the company',
    );
  });

  it('rejects a missing isActive flag', () => {
    expect(() => setUserActiveSchema.parse({})).toThrow();
  });
});

describe('audit actions', () => {
  it('includes user.activate, user.deactivate, and article note actions', () => {
    expect(AUDIT_ACTIONS).toContain('user.activate');
    expect(AUDIT_ACTIONS).toContain('user.deactivate');
    expect(AUDIT_ACTIONS).toContain('article.note.create');
    expect(AUDIT_ACTIONS).toContain('article.note.update');
    expect(AUDIT_ACTIONS).toContain('article.note.delete');
  });
});

describe('setChannelSchema', () => {
  it('requires channelName when exposing as a channel', () => {
    expect(() => setChannelSchema.parse({ isChannel: true })).toThrow();
  });

  it('accepts demoting a channel back to a plain saved search', () => {
    const parsed = setChannelSchema.parse({ isChannel: false });
    expect(parsed.isChannel).toBe(false);
  });
});

describe('articles URL filter state', () => {
  it('round-trips a compact filter panel and page', () => {
    const filters = {
      ...validFilters,
      sourceTypeTab: 'news' as const,
      projectIds: ['proj-1'],
    };
    const raw = serializeArticlesUrlState(filters, 3);
    const parsed = parseArticlesUrlState(raw);
    expect(parsed?.page).toBe(3);
    expect(parsed?.filters.sourceTypeTab).toBe('news');
    expect(parsed?.filters.projectIds).toEqual(['proj-1']);
    expect(parsed?.filters.query).toBe('inflation');
    expect(JSON.parse(raw).page).toBe(3);
    expect(JSON.parse(raw).sort).toBeUndefined();
  });

  it('returns null for missing or invalid payloads and fills defaults for empty JSON', () => {
    expect(parseArticlesUrlState(null)).toBeNull();
    expect(parseArticlesUrlState('not-json')).toBeNull();
    const empty = parseArticlesUrlState(serializeArticlesUrlState(EMPTY_FILTER_PANEL_STATE, 1));
    expect(empty?.filters).toEqual(EMPTY_FILTER_PANEL_STATE);
    expect(empty?.page).toBe(1);
  });
});

describe('createArticleNoteSchema', () => {
  it('accepts a private note without groupId', () => {
    const parsed = createArticleNoteSchema.parse({ body: 'Follow up tomorrow', visibility: 'private' });
    expect(parsed.visibility).toBe('private');
  });

  it('requires groupId when visibility is group', () => {
    expect(() => createArticleNoteSchema.parse({ body: 'Share with the team', visibility: 'group' })).toThrow();
  });
});
