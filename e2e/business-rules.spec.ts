import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

// ---------------------------------------------------------------------------------------
// API-level assertions for a handful of named hard business rules — faster and more
// precise for proving exact status codes / error shapes than clicking through the UI.
// Talks to the API directly via Playwright's `request` fixture (POST /api/auth/login for a
// token, then Authorization: Bearer <token> on every subsequent call) rather than the
// browser, mirroring e2e/admin-and-moderation.spec.ts's UI-level coverage of the same
// underlying rules where a real click-path matters more than the exact wire shape.
//
// Live-stack gated exactly like e2e/auth.spec.ts's own "requires live API" test — set
// E2E_LIVE=1 against a running API+web+DB stack to run this file.
//
// Every mutation this file performs targets either (a) data that is expected to be
// REJECTED before anything is persisted (name-uniqueness / length / cap checks — nothing to
// clean up), or (b) clearly-prefixed "E2E — ..." throwaway groups/saved
// searches/concepts/dashboards created and deleted within the same test's try/finally. The
// seeded demo dataset (its groups, saved searches, concepts, insights, dashboards) is never
// permanently mutated by this file.
// ---------------------------------------------------------------------------------------

const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000/api';

const CREDENTIALS = {
  admin: { email: 'admin@meridian.dev', password: 'ContentInsights!23' },
  analystCompliance: { email: 'analyst.compliance@meridian.dev', password: 'Jl9SnI4nHfFLZxfz083kbTKS' },
  analystComms: { email: 'analyst.comms@meridian.dev', password: 'n_vjJn8aufCyAncfmia13myT' },
} as const;

interface FilterOverrides {
  projectIds?: string[];
  taxonomyValues?: Record<string, string[]>;
}

// Mirrors packages/shared/src/types/search-filters.ts's EMPTY_FILTER_PANEL_STATE exactly
// (field-for-field) — hardcoded here rather than imported from @content-insights/shared
// since the e2e/ workspace isn't wired to resolve that package.
function emptyFilters(overrides: FilterOverrides = {}) {
  return {
    query: '',
    sourceTypeTab: 'all',
    hiddenArticles: 'exclude',
    dateFilter: null,
    projectIds: overrides.projectIds ?? [],
    taxonomyValues: overrides.taxonomyValues ?? {},
    userTagIds: [],
    advancedSearch: { enabled: false, groups: [] },
    sort: 'date_desc',
  };
}

// authRateLimiter (apps/api/src/middleware/rateLimiters.ts) is a 100-req/min-per-IP budget
// shared across the WHOLE /api/auth surface — this file's logins, combined with every OTHER
// e2e spec file logging in against the same live stack from the same IP, can trip it well
// within a minute regardless of Playwright worker count (a 429 here fails fast rather than
// hanging like a UI login would, but is the same underlying condition — see
// admin-and-moderation.spec.ts's loginUI). Retry after the fixed one-minute window rolls over
// rather than surface it as a real login failure.
async function loginAs(request: APIRequestContext, email: string, password: string): Promise<string> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await request.post(`${API_BASE}/auth/login`, { data: { email, password } });
    if (res.status() === 429) {
      if (attempt === maxAttempts) {
        throw new Error(`Login rate-limited for ${email} after ${maxAttempts} attempts`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      continue;
    }
    const body = await res.json();
    if (!res.ok() || !body.success) {
      throw new Error(`Login failed for ${email}: ${res.status()} ${JSON.stringify(body)}`);
    }
    return body.data.accessToken as string;
  }
  throw new Error(`Login failed for ${email}: unreachable`);
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function json(res: APIResponse): Promise<any> {
  return res.json();
}

test.describe('business rules (API-level)', () => {
  test.skip(() => !process.env.E2E_LIVE, 'Set E2E_LIVE=1 against a running API+web stack');

  let adminToken: string;
  let complianceToken: string;
  let commsToken: string;

  test.beforeAll(async ({ request }) => {
    // Belt-and-suspenders alongside the describe-level test.skip() above: if E2E_LIVE isn't
    // set, every test below is already skipped, so avoid attempting a real network call here
    // too (which would otherwise fail the whole file with a connection error instead of a
    // clean "skipped" report).
    if (!process.env.E2E_LIVE) return;
    adminToken = await loginAs(request, CREDENTIALS.admin.email, CREDENTIALS.admin.password);
    complianceToken = await loginAs(
      request,
      CREDENTIALS.analystCompliance.email,
      CREDENTIALS.analystCompliance.password,
    );
    commsToken = await loginAs(request, CREDENTIALS.analystComms.email, CREDENTIALS.analystComms.password);
  });

  // ---------------------------------------------------------------------------------------
  // 1. Saved search name uniqueness is global and case-insensitive.
  // ---------------------------------------------------------------------------------------
  test('1. duplicate saved search name (case-different) is rejected with SAVED_SEARCH_NAME_TAKEN', async ({
    request,
  }) => {
    const groupsRes = await request.get(`${API_BASE}/groups?page=1`, { headers: authHeaders(adminToken) });
    expect(groupsRes.ok()).toBeTruthy();
    const groupId = (await json(groupsRes)).data.items[0]?.id;
    expect(groupId, 'expected at least one seeded group').toBeTruthy();

    const res = await request.post(`${API_BASE}/saved-searches`, {
      headers: authHeaders(adminToken),
      data: {
        groupId,
        // Case-different collision with the seeded "Financial Watch — 30 Day Pulse" channel.
        name: 'financial watch — 30 day pulse',
        type: 'dynamic',
        filters: emptyFilters(),
      },
    });
    const body = await json(res);
    expect(res.status()).toBe(409);
    expect(body.code).toBe('SAVED_SEARCH_NAME_TAKEN');
  });

  // ---------------------------------------------------------------------------------------
  // 2. Snapshot cap (GlobalSettings.maxSnapshotArticles, currently 200).
  //
  // Snapshot resolution is ALWAYS scoped through one specific Group's dataAccess (see
  // savedSearch.service.ts's buildArticleMongoQuery/resolveGroupAccessContext) — even for an
  // Application Admin — so a snapshot spanning "every project, unrestricted" needs a group
  // actually granted all 4 projects with every hard-filter value allowed. No seeded group
  // is granted more than 3 projects (and those 3 are further narrowed by real domain
  // grants), so none can reach 200 on its own. A disposable, fully-permissive group is
  // created here (all 4 projects, every indexed domain value allowed on each project's hard
  // concept), used once to trigger the cap, and deleted in `finally` — no seeded group/saved
  // search is touched.
  // ---------------------------------------------------------------------------------------
  test('2. snapshot save over the org total is rejected with SNAPSHOT_LIMIT_EXCEEDED', async ({ request }) => {
    const totalRes = await request.post(`${API_BASE}/search`, {
      headers: authHeaders(adminToken),
      data: { filters: emptyFilters(), page: 1, size: 1 },
    });
    expect(totalRes.ok()).toBeTruthy();
    const orgTotal = (await json(totalRes)).data.total as number;
    // Sanity precondition named in the workflow brief: 240 seeded articles, ~8 hidden by
    // default exclusion, comfortably over the 200 cap.
    expect(orgTotal).toBeGreaterThan(200);

    const projectsRes = await request.get(`${API_BASE}/projects?page=1`, { headers: authHeaders(adminToken) });
    const projects = (await json(projectsRes)).data.items as { id: string }[];
    expect(projects.length).toBeGreaterThanOrEqual(4);

    const hardFilterGrants: { conceptId: string; conceptName: string; allowedValues: string[] }[] = [];
    for (const project of projects) {
      const conceptsRes = await request.get(`${API_BASE}/concepts?projectId=${project.id}`, {
        headers: authHeaders(adminToken),
      });
      const concepts = (await json(conceptsRes)).data as { id: string; name: string; placement: string }[];
      const hardConcept = concepts.find((c) => c.placement === 'hard');
      expect(hardConcept, `project ${project.id} should have a hard concept`).toBeTruthy();

      const valuesRes = await request.get(`${API_BASE}/concepts/${hardConcept!.id}/values`, {
        headers: authHeaders(adminToken),
      });
      const values = (await json(valuesRes)).data.values as { key: string }[];
      hardFilterGrants.push({
        conceptId: hardConcept!.id,
        conceptName: hardConcept!.name,
        allowedValues: values.map((v) => v.key),
      });
    }

    const createGroupRes = await request.post(`${API_BASE}/groups`, {
      headers: authHeaders(adminToken),
      data: { name: `E2E — Snapshot Cap Test ${Date.now()}` },
    });
    expect(createGroupRes.status()).toBe(201);
    const tempGroupId = (await json(createGroupRes)).data.id as string;

    try {
      const projectsGrantRes = await request.put(`${API_BASE}/groups/${tempGroupId}/data-access/projects`, {
        headers: authHeaders(adminToken),
        data: { projectIds: projects.map((p) => p.id) },
      });
      expect(projectsGrantRes.ok()).toBeTruthy();

      const hardFiltersRes = await request.put(`${API_BASE}/groups/${tempGroupId}/data-access/hard-filters`, {
        headers: authHeaders(adminToken),
        data: { hardFilterGrants },
      });
      expect(hardFiltersRes.ok()).toBeTruthy();

      const snapshotRes = await request.post(`${API_BASE}/saved-searches`, {
        headers: authHeaders(adminToken),
        data: {
          groupId: tempGroupId,
          name: `E2E — Snapshot Cap Attempt ${Date.now()}`,
          type: 'snapshot',
          filters: emptyFilters(),
        },
      });
      const snapshotBody = await json(snapshotRes);
      expect(snapshotRes.status()).toBe(400);
      expect(snapshotBody.code).toBe('SNAPSHOT_LIMIT_EXCEEDED');
      expect(snapshotBody.message).toContain('200');
    } finally {
      await request.delete(`${API_BASE}/groups/${tempGroupId}`, { headers: authHeaders(adminToken) });
    }
  });

  // ---------------------------------------------------------------------------------------
  // 3. Insight name length cap (INSIGHT_NAME_MAX_LENGTH = 30).
  // ---------------------------------------------------------------------------------------
  test('3. insight name over 30 characters is rejected (400)', async ({ request }) => {
    const groupsRes = await request.get(`${API_BASE}/groups?page=1`, { headers: authHeaders(adminToken) });
    const groupId = (await json(groupsRes)).data.items[0]?.id;

    const tooLongName = 'E2E Insight Name That Is Definitely Too Long'; // 44 chars
    expect(tooLongName.length).toBeGreaterThan(30);

    const res = await request.post(`${API_BASE}/insights`, {
      headers: authHeaders(adminToken),
      data: {
        groupId,
        projectIds: [],
        name: tooLongName,
        chartType: 'bar',
        sourceFilters: emptyFilters(),
        config: { fieldMappings: [] },
      },
    });
    const body = await json(res);
    expect(res.status()).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.fields?.some((f: { field: string }) => f.field === 'name')).toBe(true);
  });

  // ---------------------------------------------------------------------------------------
  // 4. User tag name length cap (USER_TAG_NAME_MAX_LENGTH = 25).
  // ---------------------------------------------------------------------------------------
  test('4. user tag name over 25 characters is rejected (400)', async ({ request }) => {
    const tooLongName = 'E2E Tag Name That Is Too Long'; // 29 chars
    expect(tooLongName.length).toBeGreaterThan(25);

    const res = await request.post(`${API_BASE}/user-tags`, {
      headers: authHeaders(commsToken),
      data: { name: tooLongName, isPrivate: true },
    });
    const body = await json(res);
    expect(res.status()).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.fields?.some((f: { field: string }) => f.field === 'name')).toBe(true);
  });

  // ---------------------------------------------------------------------------------------
  // 5. User tag name uniqueness is global and case-insensitive (not per-group).
  // ---------------------------------------------------------------------------------------
  test('5. duplicate tag name (case-different) is rejected with USER_TAG_NAME_TAKEN', async ({ request }) => {
    const res = await request.post(`${API_BASE}/user-tags`, {
      headers: authHeaders(commsToken),
      data: { name: 'BREAKING', isPrivate: false }, // case-different collision with seeded "Breaking"
    });
    const body = await json(res);
    expect(res.status()).toBe(409);
    expect(body.code).toBe('USER_TAG_NAME_TAKEN');
  });

  // ---------------------------------------------------------------------------------------
  // 6. Dashboard max-3 (DASHBOARD_MAX_INSIGHTS).
  // ---------------------------------------------------------------------------------------
  test('6. dashboard rejects a 4th insight beyond DASHBOARD_MAX_INSIGHTS (3)', async ({ request }) => {
    const insightsRes = await request.get(`${API_BASE}/insights?page=1`, { headers: authHeaders(adminToken) });
    const insights = (await json(insightsRes)).data.items as { id: string }[];
    expect(insights.length, 'expected at least 4 seeded insights').toBeGreaterThanOrEqual(4);

    const groupsRes = await request.get(`${API_BASE}/groups?page=1`, { headers: authHeaders(adminToken) });
    const groupId = (await json(groupsRes)).data.items[0]?.id;

    const createRes = await request.post(`${API_BASE}/dashboards`, {
      headers: authHeaders(adminToken),
      data: { groupId, name: `E2E — Dashboard Cap Test ${Date.now()}` },
    });
    expect(createRes.status()).toBe(201);
    const dashboardId = (await json(createRes)).data.id as string;

    try {
      for (let i = 0; i < 3; i++) {
        const addRes = await request.post(`${API_BASE}/dashboards/${dashboardId}/insights`, {
          headers: authHeaders(adminToken),
          data: { insightId: insights[i]!.id },
        });
        expect(addRes.status(), `adding insight #${i + 1} should succeed`).toBe(201);
      }

      const fourthRes = await request.post(`${API_BASE}/dashboards/${dashboardId}/insights`, {
        headers: authHeaders(adminToken),
        data: { insightId: insights[3]!.id },
      });
      const fourthBody = await json(fourthRes);
      expect(fourthRes.status()).toBe(400);
      expect(fourthBody.code).toBe('DASHBOARD_INSIGHT_LIMIT');
      expect(fourthBody.message).toContain('3');
    } finally {
      await request.delete(`${API_BASE}/dashboards/${dashboardId}`, { headers: authHeaders(adminToken) });
    }
  });

  // ---------------------------------------------------------------------------------------
  // 7. Concept name uniqueness is scoped PER PROJECT, not global.
  // ---------------------------------------------------------------------------------------
  test('7. concept name uniqueness is per-project: blocked within a project, allowed across projects', async ({
    request,
  }) => {
    const projectsRes = await request.get(`${API_BASE}/projects?page=1`, { headers: authHeaders(adminToken) });
    const projects = (await json(projectsRes)).data.items as { id: string }[];
    expect(projects.length).toBeGreaterThanOrEqual(2);
    const [projectA, projectB] = projects;

    const stamp = Date.now();
    const conceptName = `E2E Uniqueness Test ${stamp}`;
    let conceptIdA: string | undefined;
    let conceptIdB: string | undefined;

    try {
      const createARes = await request.post(`${API_BASE}/concepts?projectId=${projectA!.id}`, {
        headers: authHeaders(adminToken),
        data: { name: conceptName, key: `e2e_uniqueness_${stamp}`, placement: 'soft', displayLabel: conceptName },
      });
      expect(createARes.status()).toBe(201);
      conceptIdA = (await json(createARes)).data.id as string;

      // Same name, case-different, SAME project -> blocked.
      const dupRes = await request.post(`${API_BASE}/concepts?projectId=${projectA!.id}`, {
        headers: authHeaders(adminToken),
        data: {
          name: conceptName.toUpperCase(),
          key: `e2e_uniqueness_${stamp}_dup`,
          placement: 'soft',
          displayLabel: conceptName,
        },
      });
      const dupBody = await json(dupRes);
      expect(dupRes.status()).toBe(409);
      expect(dupBody.code).toBe('CONCEPT_NAME_TAKEN');

      // Same name, DIFFERENT project -> allowed (uniqueness is per-project, not global).
      const createBRes = await request.post(`${API_BASE}/concepts?projectId=${projectB!.id}`, {
        headers: authHeaders(adminToken),
        data: {
          name: conceptName.toUpperCase(),
          key: `e2e_uniqueness_${stamp}`,
          placement: 'soft',
          displayLabel: conceptName,
        },
      });
      expect(createBRes.status()).toBe(201);
      conceptIdB = (await json(createBRes)).data.id as string;
    } finally {
      if (conceptIdA) {
        await request.delete(`${API_BASE}/concepts/${conceptIdA}`, { headers: authHeaders(adminToken) });
      }
      if (conceptIdB) {
        await request.delete(`${API_BASE}/concepts/${conceptIdB}`, { headers: authHeaders(adminToken) });
      }
    }
  });

  // ---------------------------------------------------------------------------------------
  // 8. A group's default query cannot be deleted while it remains the default.
  //
  // Part A proves the block using the REAL seeded default ("All Financial Coverage",
  // Executive Briefing's default for Financial Markets Watch) — this is safe/non-mutating:
  // savedSearch.routes.ts's DELETE handler checks GroupDefaultQueryModel and throws BEFORE
  // ever touching the document, so a 409 here leaves the seeded record completely
  // untouched (reconfirmed via a follow-up GET).
  //
  // Part B proves the other half (clearing the default unblocks deletion) using a fully
  // disposable group + saved search instead of the real seeded default, so nothing seeded
  // is ever actually deleted by this file.
  // ---------------------------------------------------------------------------------------
  test('8. default group query cannot be deleted while default; clearing it unblocks deletion', async ({
    request,
  }) => {
    let realDefault: { id: string; name: string } | undefined;
    for (let page = 1; page <= 3 && !realDefault; page++) {
      const listRes = await request.get(`${API_BASE}/saved-searches?scope=mine&page=${page}`, {
        headers: authHeaders(adminToken),
      });
      const listBody = await json(listRes);
      const items = listBody.data.items as { id: string; name: string }[];
      realDefault = items.find((item) => item.name === 'All Financial Coverage');
      if (items.length === 0 || page >= listBody.data.totalPages) break;
    }
    expect(realDefault, 'expected to find seeded "All Financial Coverage" saved search').toBeTruthy();

    const blockedRes = await request.delete(`${API_BASE}/saved-searches/${realDefault!.id}`, {
      headers: authHeaders(adminToken),
    });
    const blockedBody = await json(blockedRes);
    expect(blockedRes.status()).toBe(409);
    expect(blockedBody.code).toBe('SAVED_SEARCH_IS_DEFAULT');

    // Confirm the seeded saved search is provably untouched by the rejected delete above.
    const stillThereRes = await request.get(`${API_BASE}/saved-searches/${realDefault!.id}`, {
      headers: authHeaders(adminToken),
    });
    expect(stillThereRes.ok()).toBeTruthy();
    expect((await json(stillThereRes)).data.savedSearch.name).toBe('All Financial Coverage');

    // Part B — disposable group/saved search.
    const projectsRes = await request.get(`${API_BASE}/projects?page=1`, { headers: authHeaders(adminToken) });
    const project = (await json(projectsRes)).data.items[0] as { id: string };

    const stamp = Date.now();
    const tempGroupRes = await request.post(`${API_BASE}/groups`, {
      headers: authHeaders(adminToken),
      data: { name: `E2E — Default Query Cleanup Test ${stamp}` },
    });
    const tempGroupId = (await json(tempGroupRes)).data.id as string;

    try {
      await request.put(`${API_BASE}/groups/${tempGroupId}/data-access/projects`, {
        headers: authHeaders(adminToken),
        data: { projectIds: [project.id] },
      });

      const savedSearchRes = await request.post(`${API_BASE}/saved-searches`, {
        headers: authHeaders(adminToken),
        data: {
          groupId: tempGroupId,
          name: `E2E — Default Query Saved Search ${stamp}`,
          type: 'dynamic',
          filters: emptyFilters({ projectIds: [project.id] }),
        },
      });
      expect(savedSearchRes.status()).toBe(201);
      const savedSearchId = (await json(savedSearchRes)).data.id as string;

      const setDefaultRes = await request.put(`${API_BASE}/groups/${tempGroupId}/default-query`, {
        headers: authHeaders(adminToken),
        data: { projectId: project.id, savedSearchId },
      });
      expect(setDefaultRes.ok()).toBeTruthy();

      const blockedDeleteRes = await request.delete(`${API_BASE}/saved-searches/${savedSearchId}`, {
        headers: authHeaders(adminToken),
      });
      const blockedDeleteBody = await json(blockedDeleteRes);
      expect(blockedDeleteRes.status()).toBe(409);
      expect(blockedDeleteBody.code).toBe('SAVED_SEARCH_IS_DEFAULT');

      const clearRes = await request.delete(`${API_BASE}/groups/${tempGroupId}/default-query/${project.id}`, {
        headers: authHeaders(adminToken),
      });
      expect(clearRes.ok()).toBeTruthy();

      const succeedsRes = await request.delete(`${API_BASE}/saved-searches/${savedSearchId}`, {
        headers: authHeaders(adminToken),
      });
      expect(succeedsRes.ok()).toBeTruthy();
    } finally {
      await request.delete(`${API_BASE}/groups/${tempGroupId}`, { headers: authHeaders(adminToken) });
    }
  });

  // ---------------------------------------------------------------------------------------
  // 9. Hard-value RBAC cannot be bypassed by a crafted request: Risk & Compliance is granted
  // only reuters-wire.example / globalfinance-daily.example for Financial Markets Watch.
  // ---------------------------------------------------------------------------------------
  test('9. requesting an ungranted domain directly never leaks it into search results', async ({ request }) => {
    const projectsRes = await request.get(`${API_BASE}/projects?page=1`, { headers: authHeaders(complianceToken) });
    const projects = (await json(projectsRes)).data.items as { id: string; name: string }[];
    const financial = projects.find((p) => p.name === 'Financial Markets Watch');
    expect(financial, 'analyst.compliance should see Financial Markets Watch').toBeTruthy();

    // In FINANCE_DOMAINS but NOT in Risk & Compliance's grant (only the two wire services are).
    const ungrantedDomain = 'marketpulse-news.example';

    const res = await request.post(`${API_BASE}/search`, {
      headers: authHeaders(complianceToken),
      data: {
        filters: emptyFilters({
          projectIds: [financial!.id],
          taxonomyValues: { source_domain_financial: [ungrantedDomain] },
        }),
        page: 1,
        size: 20,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await json(res);
    expect(body.data.total).toBe(0);
    expect(body.data.hits).toHaveLength(0);
    expect(body.data.hits.every((hit: { domain: string }) => hit.domain !== ungrantedDomain)).toBe(true);
  });

  // ---------------------------------------------------------------------------------------
  // 10. Teams share bulk cap (GlobalSettings.msTeams.maxArticlesPerShare, currently 25).
  // ---------------------------------------------------------------------------------------
  test('10. Teams share rejects more articles than maxArticlesPerShare (25)', async ({ request }) => {
    const articles = Array.from({ length: 26 }, (_, i) => ({
      title: `E2E Share Article ${i + 1}`,
      url: `https://example.com/e2e-share-${i + 1}`,
    }));

    const res = await request.post(`${API_BASE}/teams/share`, {
      headers: authHeaders(adminToken),
      data: { message: 'E2E bulk-share cap test', mentions: [], articles, useAppDeepLink: true },
    });
    const body = await json(res);
    expect(res.status()).toBe(400);
    // Whether this is rejected by the outer zod sanity cap or the org's own configured
    // TEAMS_SHARE_LIMIT_EXCEEDED check (both currently sit at 25), the response must clearly
    // name the 25-article limit either way.
    expect(JSON.stringify(body)).toContain('25');
  });
});
