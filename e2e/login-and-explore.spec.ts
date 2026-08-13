import { expect, test, type APIRequestContext, type Locator } from '@playwright/test';

// ---------------------------------------------------------------------------------------
// Workflow #1 (Login → load permissions → select project & user group → land on Articles,
// often via group default query) and Workflow #2 (Explore: LHS filters → taxonomies/dates
// → optional Advanced Search → sort/paginate → read/expand cards).
//
// Requires the live stack (API + web + Mongo/Elasticsearch/Redis) — see e2e/auth.spec.ts for
// the same E2E_LIVE gating convention this file follows. Run with:
//   E2E_LIVE=1 npx playwright test e2e/login-and-explore.spec.ts
//
// This file reads real, seeded ground truth from the API wherever the assertions depend on
// exact counts/names (data-access grants, facet counts) rather than hard-coding the task
// brief's recap — see the inline API calls below each of which was independently verified
// against the live seed before being asserted on. Nothing here runs SEED_RESET; the one test
// that mutates persistent state (workflow #2 — currentProjectId, defaultResultView) restores
// both in an afterAll so the seeded demo account is left exactly as it was found.
// ---------------------------------------------------------------------------------------

const API_BASE_URL = process.env.VITE_API_URL ?? 'http://localhost:4000/api';

interface ApiLoginResult {
  accessToken: string;
  user: {
    id: string;
    currentGroupId: string | null;
    currentProjectId: string | null;
    roleAssignments: { groupId: string | null; groupName?: string }[];
  };
}

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<ApiLoginResult> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, { data: { email, password } });
  const body = await response.json();
  if (!body.success) {
    throw new Error(`API login failed for ${email}: ${body.message}`);
  }
  return body.data as ApiLoginResult;
}

async function fetchAccessibleProjectNames(request: APIRequestContext, accessToken: string): Promise<string[]> {
  const response = await request.get(`${API_BASE_URL}/projects?page=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json();
  if (!body.success) {
    throw new Error(`GET /projects failed: ${body.message}`);
  }
  return (body.data.items as { name: string }[]).map((project) => project.name);
}

async function fetchMySettings(request: APIRequestContext, accessToken: string): Promise<{ defaultResultView: string }> {
  const response = await request.get(`${API_BASE_URL}/settings/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json();
  if (!body.success) {
    throw new Error(`GET /settings/me failed: ${body.message}`);
  }
  return body.data;
}

async function selectedOptionText(select: Locator): Promise<string> {
  return select.evaluate((el: HTMLSelectElement) => el.options[el.selectedIndex]?.textContent?.trim() ?? '');
}

async function optionTexts(select: Locator, excludeValues: string[]): Promise<string[]> {
  return select.evaluate(
    (el: HTMLSelectElement, exclude: string[]) =>
      Array.from(el.options)
        .filter((option) => !exclude.includes(option.value))
        .map((option) => option.textContent?.trim() ?? ''),
    excludeValues,
  );
}

// authRateLimiter (apps/api/src/middleware/rateLimiters.ts) is a 100-req/min-per-IP budget
// shared across the WHOLE /api/auth surface — this file's logins, combined with every OTHER
// e2e spec file logging in against the same live stack from the same IP, can trip it well
// within a minute regardless of Playwright worker count. A "stuck" login here is actually the
// form re-showing "Too many authentication requests." — retrying after the fixed one-minute
// window rolls over is what resolves it, not a longer single wait. Same pattern as
// admin-and-moderation.spec.ts's loginUI.
async function loginViaUi(page: import('@playwright/test').Page, email: string, password: string): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Log in' }).click();
    try {
      await page.waitForURL('**/articles', { timeout: 10_000 });
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await page.waitForTimeout(20_000);
    }
  }
}

const ANALYST_COMPLIANCE = { email: 'analyst.compliance@meridian.dev', password: 'Jl9SnI4nHfFLZxfz083kbTKS' };
const ANALYST_EXEC = { email: 'analyst.exec@meridian.dev', password: '0ef-a2fYhE7gaqoYX5jBaiFw' };

test.describe('Workflow #1 + #2 — login, land on Articles, explore (Risk & Compliance analyst)', () => {
  test.skip(!process.env.E2E_LIVE, 'Set E2E_LIVE=1 against a running API+web stack');

  // workflow #2 mutates the seeded account's currentProjectId and UserSettings.defaultResultView
  // (both are real, persisted server-side fields — see users-api.ts/settings-api.ts). Captured
  // once up front and restored in afterAll regardless of pass/fail, so the demo account is left
  // exactly as seeded for whoever uses it after this run.
  let originalDefaultResultView: string | null = null;

  test.beforeAll(async ({ request }) => {
    const { accessToken } = await apiLogin(request, ANALYST_COMPLIANCE.email, ANALYST_COMPLIANCE.password);
    const settings = await fetchMySettings(request, accessToken);
    originalDefaultResultView = settings.defaultResultView;

    // currentProjectId is a real, server-persisted field on this SHARED seeded account —
    // tags-insights-dashboards.spec.ts's "private tag" test also legitimately flips it
    // (and reverts it) mid-test, on this same account, from a different worker. workflow #1
    // below asserts this account starts with no project selected as part of what it's
    // actually testing, so it establishes that precondition itself here rather than gambling
    // on winning a race against whatever else happens to be running concurrently.
    await request.patch(`${API_BASE_URL}/users/me/current-project`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { projectId: null },
    });
  });

  test.afterAll(async ({ request }) => {
    const { accessToken } = await apiLogin(request, ANALYST_COMPLIANCE.email, ANALYST_COMPLIANCE.password);
    await request.patch(`${API_BASE_URL}/users/me/current-project`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { projectId: null },
    });
    if (originalDefaultResultView) {
      await request.patch(`${API_BASE_URL}/settings/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { defaultResultView: originalDefaultResultView },
      });
    }
  });

  test('workflow #1: logs in, lands on Articles, and project/group selectors reflect Risk & Compliance access', async ({
    page,
    request,
  }) => {
    // Ground truth from the API — do not assume the task brief's recap is exact.
    const { accessToken, user } = await apiLogin(request, ANALYST_COMPLIANCE.email, ANALYST_COMPLIANCE.password);
    const grantedProjectNames = await fetchAccessibleProjectNames(request, accessToken);
    const grantedGroupNames = user.roleAssignments
      .filter((assignment) => assignment.groupId !== null)
      .map((assignment) => assignment.groupName ?? '');
    expect(grantedProjectNames.length).toBeGreaterThan(0);
    expect(grantedGroupNames).toEqual(['Risk & Compliance']);

    await loginViaUi(page, ANALYST_COMPLIANCE.email, ANALYST_COMPLIANCE.password);

    // Landed on Articles.
    await expect(page).toHaveURL(/\/articles$/);
    await expect(page.getByRole('heading', { name: 'Articles' })).toBeVisible();

    const projectSelect = page.getByLabel('Current project');
    const groupSelect = page.getByLabel('Current group');

    // Wait for both selects to finish populating from the API before reading their options.
    await expect(projectSelect.locator('option')).toHaveCount(grantedProjectNames.length + 1); // +1 for "All projects"
    await expect(groupSelect.locator('option')).toHaveCount(grantedGroupNames.length + 1); // +1 for "No group"

    const projectOptionTexts = await optionTexts(projectSelect, ['']);
    const groupOptionTexts = await optionTexts(groupSelect, ['']);
    expect(projectOptionTexts.sort()).toEqual([...grantedProjectNames].sort());
    expect(groupOptionTexts.sort()).toEqual([...grantedGroupNames].sort());

    // currentGroupId is seeded (Risk & Compliance) — the group selector should already
    // reflect it. currentProjectId is null on this seeded account, so "All projects" is
    // the expected initial selection (no project auto-selected).
    await expect(selectedOptionText(groupSelect)).resolves.toBe('Risk & Compliance');
    await expect(selectedOptionText(projectSelect)).resolves.toBe('All projects');
  });

  test('workflow #2: LHS filters, Advanced Search, sort, view mode, and card expand/collapse', async ({ page, request }) => {
    test.setTimeout(90_000);

    await loginViaUi(page, ANALYST_COMPLIANCE.email, ANALYST_COMPLIANCE.password);

    const resultsCount = page.getByTestId('results-count');
    const projectSelect = page.getByLabel('Current project');

    // Switch into a project so FilterPanel's taxonomy sections have concepts to render
    // (ArticlesPage only fetches concepts once a currentProjectId is set — see its
    // conceptsQuery `enabled: currentProjectId !== null`).
    await projectSelect.selectOption({ label: 'Financial Markets Watch' });

    // Baseline total for Risk & Compliance scoped to Financial Markets Watch, verified
    // directly against POST /api/search with equivalent filters before writing this test
    // (hard-filter-restricted to the group's 2 allowed wire-service domains for this project).
    await expect(resultsCount).toHaveText('12 results');

    // ---------------------------------------------------------------------------------
    // LHS FilterPanel — soft taxonomy value narrows results and produces a chip.
    // Desktop layout keeps the facet column open (complementary, not a dialog).
    // ---------------------------------------------------------------------------------
    const filtersPanel = page.getByRole('complementary', { name: 'Filters' });
    await expect(filtersPanel).toBeVisible();

    await filtersPanel.getByRole('button', { name: 'Authors', exact: true }).click();
    await filtersPanel.getByLabel('Anika Voss').check();
    await expect(resultsCount).toHaveText('7 results');
    await expect(page.getByText('Authors: Anika Voss')).toBeVisible();

    // Undo the taxonomy pick (uncheck, not "Clear All" — Clear All also resets the project
    // scope, which would break every count below).
    await filtersPanel.getByLabel('Anika Voss').uncheck();
    await expect(resultsCount).toHaveText('12 results');

    // ---------------------------------------------------------------------------------
    // Hidden Articles filter — "only hidden" surfaces the seeded hidden article(s) visible
    // to this group+project (1 of the org's 8 seeded hidden articles is reachable here; the
    // other 7 sit in projects/domains this group has no grant for).
    // ---------------------------------------------------------------------------------
    await filtersPanel.getByLabel('Show only hidden articles').check();
    await expect(resultsCount).toHaveText('1 result');
    await expect(page.getByTestId('article-card')).toHaveCount(1);

    await filtersPanel.getByLabel('Exclude hidden articles').check();
    await expect(resultsCount).toHaveText('12 results');

    // ---------------------------------------------------------------------------------
    // Date filter — Last N Days narrows sensibly (verified: 30 days -> 7 of the 12).
    // ---------------------------------------------------------------------------------
    // "Date" is open by default (unlike the taxonomy sections above) — no header click needed.
    await filtersPanel.getByLabel('Last N days').check();
    await filtersPanel.getByLabel('Number of days').fill('30');
    await expect(resultsCount).toHaveText('7 results');

    await filtersPanel.getByLabel('Any time').check();
    await expect(resultsCount).toHaveText('12 results');

    // ---------------------------------------------------------------------------------
    // Advanced Search — a 2-condition query (free text AND a taxonomy condition), applied.
    // ---------------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Advanced Search' }).click();
    const advancedModal = page.getByTestId('advanced-search-modal');
    await expect(advancedModal).toBeVisible();

    const conditionRows = advancedModal.getByTestId('advanced-condition-row');
    await expect(conditionRows).toHaveCount(1); // seeded with one empty free-text condition

    await conditionRows.nth(0).getByTestId('advanced-condition-value-input').fill('market');
    await conditionRows.nth(0).getByTestId('advanced-condition-value-input').press('Enter');

    await advancedModal.getByRole('button', { name: 'Add condition' }).click();
    await expect(conditionRows).toHaveCount(2);

    await conditionRows.nth(1).getByTestId('advanced-condition-mode-select').selectOption('taxonomy');
    await conditionRows.nth(1).getByTestId('advanced-condition-concept-select').selectOption({ label: 'Authors' });
    await conditionRows.nth(1).getByTestId('advanced-condition-value-input').fill('Anika Voss');
    await conditionRows.nth(1).getByTestId('advanced-condition-value-input').press('Enter');

    await advancedModal.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('advanced-search-modal')).toHaveCount(0);

    // Summary banner reflects both conditions (AND-joined, per operatorToNext default).
    const summaryBanner = page.getByTestId('advanced-search-summary-banner');
    await expect(summaryBanner).toBeVisible();
    await expect(summaryBanner).toContainText('Advanced search active');
    await expect(summaryBanner).toContainText('Text is any of "market"');
    await expect(summaryBanner).toContainText('Authors is any of "Anika Voss"');

    // Results narrow accordingly — verified directly via POST /api/search before writing
    // this test: exactly 1 article matches both conditions.
    await expect(resultsCount).toHaveText('1 result');
    await expect(page.getByTestId('article-card')).toHaveCount(1);

    await summaryBanner.getByRole('button', { name: 'Clear' }).click();
    await expect(resultsCount).toHaveText('12 results');

    // ---------------------------------------------------------------------------------
    // Sort order.
    // ---------------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Sort: Newest first' }).click();
    await page.getByRole('menuitem', { name: 'Title A→Z', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sort: Title A→Z' })).toBeVisible();

    // The sort button's own label updates immediately (it just reflects the selected
    // choice), independently of the results refetch it triggers — wait for that refetch to
    // actually land (still the same 12-result set, just reordered) before reading titles, or
    // a slow response under load can be read mid-flight as an empty/stale card list.
    await expect(page.getByTestId('article-card-title')).toHaveCount(12);
    const titlesAfterSort = await page.getByTestId('article-card-title').allTextContents();
    expect(titlesAfterSort.length).toBeGreaterThan(1);
    // The backend sorts on the raw `title.keyword` field (see search.ts's buildSortClause) —
    // JS's default Array#sort (UTF-16 code-unit order) mirrors that Elasticsearch keyword
    // ordering for this ASCII dataset, so compare against it rather than a locale collator.
    const sortedTitles = [...titlesAfterSort].sort();
    expect(titlesAfterSort).toEqual(sortedTitles);

    // ---------------------------------------------------------------------------------
    // View mode — list/grid2x2/grid3x4 double as the page-size control (50/4/12 per page).
    // Total is 12, so 2x2 shows a partial page (4 of 12, paginated) and 3x4 shows all 12 on
    // one page.
    // ---------------------------------------------------------------------------------
    await page.getByTitle('Grid 2×2 (4/page)').click();
    await expect(page.getByTestId('article-card')).toHaveCount(4);
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toBeVisible();

    await page.getByTitle('Grid 3×4 (12/page)').click();
    await expect(page.getByTestId('article-card')).toHaveCount(12);
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toHaveCount(0);

    // ---------------------------------------------------------------------------------
    // Expand / collapse a card to read full content.
    // ---------------------------------------------------------------------------------
    const firstCard = page.getByTestId('article-card').first();
    await firstCard.getByRole('button', { name: 'Expand' }).click();
    await expect(firstCard.getByRole('button', { name: 'Collapse' })).toBeVisible();

    await firstCard.getByRole('button', { name: 'Collapse' }).click();
    await expect(firstCard.getByRole('button', { name: 'Expand' })).toBeVisible();
  });
});

test.describe('Workflow #1 — group default query on landing (Executive Briefing)', () => {
  test.skip(!process.env.E2E_LIVE, 'Set E2E_LIVE=1 against a running API+web stack');

  // FINDING: Executive Briefing's "All Financial Coverage" saved search is configured as the
  // group's default query for the Financial Markets Watch project (confirmed live: that saved
  // search exists, is scoped to that group, and its filters are `projectIds: [<Financial
  // Markets Watch id>]`). But nothing in the web app currently *applies* it on landing:
  //   - ArticlesPage never fetches or applies any GroupDefaultQuery (grepped the whole page —
  //     no reference at all; only groups-api.ts/saved-searches-api.ts expose SET/CLEAR).
  //   - There isn't even a GET endpoint to read a group's configured default query back — the
  //     admin Data Access modal's own Default Query tab says so explicitly: "There is
  //     currently no way to look up an existing default from here; the note under each
  //     project reflects only changes made in this session."
  //   - Login itself leaves currentProjectId as null (verified via POST /api/auth/login for
  //     analyst.exec@meridian.dev), so the "project context" workflow #1 describes isn't
  //     switched automatically either.
  // This test asserts the CORRECT/expected behavior and is marked test.fail() so it documents
  // the gap without silently working around it or failing the suite — if this ever starts
  // passing, Playwright will flag it as an unexpected pass, which is the signal to remove the
  // annotation.
  test.fail();

  test('logging in as an Executive Briefing member auto-lands on the Financial Markets Watch project via its default query', async ({
    page,
  }) => {
    await loginViaUi(page, ANALYST_EXEC.email, ANALYST_EXEC.password);
    await expect(page).toHaveURL(/\/articles$/);

    const projectSelect = page.getByLabel('Current project');
    await expect(selectedOptionText(projectSelect)).resolves.toBe('Financial Markets Watch');
  });
});

test.describe('Login page — break-glass credentials form', () => {
  test.skip(!process.env.E2E_LIVE, 'Set E2E_LIVE=1 against a running API+web stack');

  test('credentials form is visible without touching SSO', async ({ page, request }) => {
    // Check whether SSO is even configured in this environment before asserting on its UI
    // state, rather than assuming either way.
    const ssoResponse = await request.get(`${API_BASE_URL}/auth/sso/status`);
    const ssoBody = await ssoResponse.json();
    expect(ssoBody.success).toBe(true);
    const ssoEnabled: boolean = ssoBody.data.enabled;

    await page.goto('/login');

    // The email/password form must always be visibly reachable — LoginPage's own module
    // comment calls this the "break-glass" path (e.g. an org admin locked out of a
    // misconfigured SSO provider) that must never be hidden behind a click, whether or not
    // SSO is configured.
    await expect(page.getByRole('heading', { name: 'Content Insights' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();

    const ssoButton = page.getByRole('link', { name: 'Sign in with SSO' });
    if (ssoEnabled) {
      await expect(ssoButton).toBeVisible();
    } else {
      // SSO is disabled in this environment (GET /auth/sso/status returned enabled: false) —
      // the SSO button/divider should not render at all, and the credentials form should be
      // the only path in, not a fallback revealed after an SSO failure.
      await expect(ssoButton).toHaveCount(0);
    }
  });
});
