import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------------------
// Live-stack coverage for workflow #5 (Collaborate: tag privacy, saved-search sharing,
// Teams share) and workflow #6 (Analyze: Articles -> Insights -> Dashboard, incl. the
// hard max-3-insights rule). Gated the same way as e2e/auth.spec.ts's live test.
//
// Every entity this file creates is prefixed "E2E — " and deleted again before the test
// that created it finishes, so the seeded demo dataset is left exactly as it was found.
// A couple of tests also flip a seeded user's `currentProjectId` (unavoidable — the
// Insights builder only offers fields to map once a project is selected) and restore it
// to "All projects" afterward as a courtesy.
// ---------------------------------------------------------------------------------------

const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000/api';

const RUN_ID = Date.now().toString(36);
const SUFFIX = RUN_ID.slice(-5);

const PUBLIC_TAG_NAME = `E2E — Tag-${SUFFIX}`;
const PRIVATE_TAG_NAME = `E2E — Priv-${SUFFIX}`;
const INSIGHT_NAME = `E2E — Insight-${RUN_ID}`;
const DASHBOARD_NAME = `E2E — Dash-${RUN_ID}`;
const SAVED_SEARCH_NAME = `E2E — Search-${RUN_ID}`;

// authRateLimiter (apps/api/src/middleware/rateLimiters.ts) is a 100-req/min-per-IP budget
// shared across the WHOLE /api/auth surface — when this file runs alongside the other e2e
// spec files (all hitting the same live stack from the same IP), the suite's *cumulative*
// login volume can trip it well within a minute, independent of how many Playwright workers
// are running it. Confirmed live: a "stuck" login here is actually the login form re-showing
// "Too many authentication requests. Please try again later." — waiting longer never helps
// (same request, same rejection), only retrying after the fixed one-minute window rolls over
// does. Same pattern as admin-and-moderation.spec.ts's loginUI.
async function login(page: Page, email: string, password: string): Promise<void> {
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

// Clicking a card's "Tag" button opens the (shared) TagSelectPopover — under load, a click
// landing the same instant the article list re-renders can occasionally be swallowed by the
// browser without opening it. Rather than let a bare `.fill()` on the search box retry its
// actionability checks silently for the rest of the test's timeout budget (an unbounded,
// undiagnosable hang if the popover never opened), wait on a short bounded timeout and retry
// the click once before giving up with a clear error.
async function openTagPickerFor(page: Page, tagButton: Locator): Promise<void> {
  const searchInput = page.getByPlaceholder('Search tags…');
  await tagButton.click();
  try {
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
  } catch {
    await tagButton.click();
    await expect(searchInput).toBeVisible({ timeout: 15_000 });
  }
}

// Same shared-rate-limit-budget reasoning as login() above — retry a 429 rather than surface
// it as a real login failure.
async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await request.post(`${API_BASE}/auth/login`, { data: { email, password } });
    if (res.status() === 429) {
      if (attempt === maxAttempts) {
        throw new Error(`API login rate-limited for ${email} after ${maxAttempts} attempts`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      continue;
    }
    const body = (await res.json()) as { success: boolean; data?: { accessToken: string }; message?: string };
    if (!body.success || !body.data) {
      throw new Error(`API login failed for ${email}: ${JSON.stringify(body)}`);
    }
    return body.data.accessToken;
  }
  throw new Error(`API login failed for ${email}: unreachable`);
}

// TagChipsRow collapses beyond 4 chips behind a "+N more" toggle — expand it if the chip
// we're looking for isn't in the first batch, rather than assume every fixture article has
// few enough existing tags to always show ours.
async function expectTagChipVisible(articleCard: Locator, tagName: string): Promise<void> {
  const chip = articleCard.getByTitle(`Filter by "${tagName}"`);
  if ((await chip.count()) === 0) {
    const more = articleCard.getByRole('button', { name: /more$/ });
    if ((await more.count()) > 0) {
      await more.first().click();
    }
  }
  await expect(articleCard.getByTitle(`Filter by "${tagName}"`)).toBeVisible();
}

async function resetCurrentProject(page: Page): Promise<void> {
  await page.goto('/articles');
  const projectSelect = page.getByLabel('Current project');
  await expect(projectSelect).toBeVisible();
  await projectSelect.selectOption('');
}

test.describe('Collaborate & Analyze (tags, saved-search sharing, Teams share, insights & dashboards)', () => {
  test.beforeEach(() => {
    test.skip(!process.env.E2E_LIVE, 'Set E2E_LIVE=1 against a running API+web stack');
  });

  test('public tag: create via bulk picker, apply to articles, chip renders on cards', async ({ page }) => {
    await login(page, 'analyst.comms@meridian.dev', 'n_vjJn8aufCyAncfmia13myT');

    await expect(page.locator('[data-testid="article-card"]').first()).toBeVisible({ timeout: 20_000 });

    const titleLocator = page.locator('[data-testid="article-card-title"]');
    const title0 = ((await titleLocator.nth(0).textContent()) ?? '').trim();
    const title1 = ((await titleLocator.nth(1).textContent()) ?? '').trim();
    expect(title0).not.toBe('');
    expect(title1).not.toBe('');

    const checkboxes = page.locator('[data-testid="article-card"] input[type="checkbox"]');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    await expect(page.getByText('2 selected')).toBeVisible();

    await page.getByTestId('bulk-tag-button').click();
    await page.getByRole('button', { name: 'Create new tag' }).click();
    await page.getByPlaceholder('Tag name').fill(PUBLIC_TAG_NAME);
    await page.getByRole('button', { name: 'Create & apply' }).click();

    await expect(page.getByText('Updated 2 articles.')).toBeVisible({ timeout: 15_000 });

    const card0 = page.locator('[data-testid="article-card"]').filter({ hasText: title0 });
    const card1 = page.locator('[data-testid="article-card"]').filter({ hasText: title1 });
    await expectTagChipVisible(card0, PUBLIC_TAG_NAME);
    await expectTagChipVisible(card1, PUBLIC_TAG_NAME);

    // --- cleanup: delete the tag (also strips it from both articles server-side) ---
    await page.goto('/tags');
    const row = page.locator('li').filter({ hasText: PUBLIC_TAG_NAME });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByTestId('delete-tag-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Tag deleted and removed from every article that used it.')).toBeVisible();
    await expect(row).toHaveCount(0);
  });

  test('private tag: never visible by name to a user with no relationship to the owner group', async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(120_000);

    // --- analyst.compliance (Risk & Compliance): create a private tag and attach it ---
    await login(page, 'analyst.compliance@meridian.dev', 'Jl9SnI4nHfFLZxfz083kbTKS');

    await page.goto('/tags');
    await page.getByLabel('Name', { exact: true }).fill(PRIVATE_TAG_NAME);
    await page.getByRole('switch', { name: 'Make this tag private' }).click();
    await page.getByRole('button', { name: 'Create tag' }).click();
    await expect(page.getByText('Tag created.')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('li').filter({ hasText: PRIVATE_TAG_NAME })).toBeVisible();

    await page.goto('/articles');
    await page.getByLabel('Current project').selectOption({ label: 'Financial Markets Watch' });
    await expect(page.locator('[data-testid="article-card"]').first()).toBeVisible({ timeout: 20_000 });

    const taggedTitle = ((await page.locator('[data-testid="article-card-title"]').first().textContent()) ?? '').trim();
    expect(taggedTitle).not.toBe('');
    const taggedCard = page.locator('[data-testid="article-card"]').filter({ hasText: taggedTitle });

    await openTagPickerFor(page, taggedCard.getByRole('button', { name: 'Tag', exact: true }));
    await page.getByPlaceholder('Search tags…').fill(PRIVATE_TAG_NAME);
    await page.getByRole('button', { name: new RegExp(PRIVATE_TAG_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await expect(page.getByText('Updated 1 article.')).toBeVisible({ timeout: 10_000 });
    await expectTagChipVisible(taggedCard, PRIVATE_TAG_NAME);

    await resetCurrentProject(page);

    // --- analyst.market (Market Research Desk): no relationship to Risk & Compliance ---
    const marketContext = await browser.newContext();
    const marketPage = await marketContext.newPage();
    try {
      await login(marketPage, 'analyst.market@meridian.dev', 'g4Vu1HF8HliBwUzwg4AH5MGd');

      await marketPage.goto('/articles');
      await marketPage.getByLabel('Current project').selectOption({ label: 'Financial Markets Watch' });
      // Default sort is "Newest first", which wouldn't reliably surface a text match near the
      // top of a large result set — switch to Relevance so the (near-)exact title match ranks
      // first and is guaranteed to land on the (50-per-page) list view's first page.
      await marketPage.getByRole('button', { name: /^Sort:/ }).click({ timeout: 15_000 });
      await marketPage.getByRole('button', { name: 'Relevance', exact: true }).click({ timeout: 15_000 });

      const [searchResponse] = await Promise.all([
        marketPage.waitForResponse((res) => res.request().method() === 'POST' && res.url().endsWith('/search'), {
          timeout: 20_000,
        }),
        marketPage.getByPlaceholder('Search articles…').fill(taggedTitle),
      ]);
      const searchBody = (await searchResponse.json()) as {
        success: boolean;
        data: { hits: Array<{ articleId: string; title: string }> };
      };
      const matchingHit = searchBody.data.hits.find((hit) => hit.title === taggedTitle);
      expect(matchingHit).toBeDefined();
      const taggedArticleId = matchingHit!.articleId;

      const foundCard = marketPage.locator('[data-testid="article-card"]').filter({ hasText: taggedTitle });
      await expect(foundCard).toBeVisible({ timeout: 20_000 });
      // 1) no chip anywhere on the card, however many other chips it collapses behind "+N more"
      const moreToggle = foundCard.getByRole('button', { name: /more$/ });
      if ((await moreToggle.count()) > 0) {
        await moreToggle.first().click({ timeout: 15_000 });
      }
      await expect(foundCard.getByTitle(`Filter by "${PRIVATE_TAG_NAME}"`)).toHaveCount(0);

      // 2) not offered in the tag picker, even when searched for by exact name
      await openTagPickerFor(marketPage, foundCard.getByRole('button', { name: 'Tag', exact: true }));
      await marketPage.getByPlaceholder('Search tags…').fill(PRIVATE_TAG_NAME);
      await expect(marketPage.getByText('No matching tags.')).toBeVisible({ timeout: 10_000 });
      await expect(marketPage.getByRole('button', { name: PRIVATE_TAG_NAME, exact: true })).toHaveCount(0);

      // 3) not discoverable by searching its name in the main Articles search box
      await marketPage.getByPlaceholder('Search articles…').fill(PRIVATE_TAG_NAME);
      await expect(marketPage.getByTestId('results-count')).toHaveText('0 results', { timeout: 20_000 });

      // 4) not shown as a chip on the article's own deep-linkable detail page either
      await marketPage.goto(`/articles/${taggedArticleId}`);
      // 25s: observed once to land right when several *other* logins elsewhere in the suite
      // were backed off waiting out the shared auth rate limit (see login()/apiLogin() above)
      // — general load across the live stack spikes right along with that, same underlying
      // cause, just felt here as a slower render rather than a 429.
      await expect(marketPage.getByText('No tags yet.')).toBeVisible({ timeout: 25_000 });
      await expect(marketPage.getByText(PRIVATE_TAG_NAME)).toHaveCount(0);

      await resetCurrentProject(marketPage);

      // 5) explicit, non-UI assertion: GET /user-tags never returns the private tag's name
      const marketToken = await apiLogin(request, 'analyst.market@meridian.dev', 'g4Vu1HF8HliBwUzwg4AH5MGd');
      const tagsRes = await request.get(`${API_BASE}/user-tags`, {
        headers: { Authorization: `Bearer ${marketToken}` },
      });
      expect(tagsRes.ok()).toBe(true);
      const tagsBody = (await tagsRes.json()) as { success: boolean; data: Array<{ name: string }> };
      expect(tagsBody.success).toBe(true);
      expect(tagsBody.data.some((tag) => tag.name === PRIVATE_TAG_NAME)).toBe(false);
    } finally {
      await marketContext.close();
    }

    // --- cleanup: delete the private tag as its owner group (also strips it from the article) ---
    await page.goto('/tags');
    const privateRow = page.locator('li').filter({ hasText: PRIVATE_TAG_NAME });
    await expect(privateRow).toBeVisible();
    await privateRow.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByTestId('delete-tag-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Tag deleted and removed from every article that used it.')).toBeVisible();
  });

  test('saved search: shared into another group becomes visible from that group\'s Load list', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);

    // --- sharer (Analyst + Sharing Rights Into @ Executive Briefing): save then share ---
    await login(page, 'sharer@meridian.dev', 'rkTL9Gp1D-HerclJeUzXXe2k');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Save', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill(SAVED_SEARCH_NAME);
    await page.getByRole('button', { name: 'Save search', exact: true }).click();
    // A successful save switches the modal to its Load/browse tab (rather than closing) and
    // shows the new item there immediately — the subsequent page.goto() below unmounts it.
    await expect(page.getByText(SAVED_SEARCH_NAME).first()).toBeVisible({ timeout: 10_000 });

    await page.goto('/saved-searches');
    const ownRow = page.locator('tr').filter({ hasText: SAVED_SEARCH_NAME });
    await expect(ownRow).toBeVisible({ timeout: 15_000 });
    await ownRow.getByRole('button', { name: 'Share', exact: true }).click();

    const shareDialog = page.getByTestId('saved-search-share-dialog');
    await expect(shareDialog).toBeVisible();
    await shareDialog.getByText('Market Research Desk', { exact: true }).click();
    await shareDialog.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.getByText('Shared.')).toBeVisible({ timeout: 10_000 });

    // --- analyst.market (Market Research Desk): the shared search now shows up in Load ---
    const marketContext = await browser.newContext();
    const marketPage = await marketContext.newPage();
    try {
      await login(marketPage, 'analyst.market@meridian.dev', 'g4Vu1HF8HliBwUzwg4AH5MGd');
      await marketPage.getByRole('button', { name: 'More actions' }).click();
      await marketPage.getByRole('menuitem', { name: 'Load', exact: true }).click();
      await expect(marketPage.locator('tr').filter({ hasText: SAVED_SEARCH_NAME })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await marketContext.close();
    }

    // --- cleanup: delete the saved search (soft-delete; drops the share with it) ---
    await page.goto('/saved-searches');
    const rowAgain = page.locator('tr').filter({ hasText: SAVED_SEARCH_NAME });
    await expect(rowAgain).toBeVisible();
    await rowAgain.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByTestId('delete-saved-search-dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Deleted.')).toBeVisible({ timeout: 10_000 });
  });

  test('Teams share: honest "no live connection" notice, submit yields a recorded confirmation', async ({ page }) => {
    await login(page, 'admin@meridian.dev', 'ContentInsights!23');

    await expect(page.locator('[data-testid="article-card"]').first()).toBeVisible({ timeout: 20_000 });
    const checkboxes = page.locator('[data-testid="article-card"] input[type="checkbox"]');
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    await page.getByRole('button', { name: 'Share to Teams', exact: true }).click();

    const modal = page.getByTestId('teams-share-modal');
    await expect(modal).toBeVisible();
    await expect(
      modal.getByText(/no live Microsoft Teams connection is configured in this environment/i),
    ).toBeVisible();

    await modal.getByLabel(/Message/).fill('Automated E2E check — please disregard.');
    await modal.getByRole('button', { name: 'Share to Teams', exact: true }).click();

    await expect(modal.getByText('Share recorded')).toBeVisible({ timeout: 15_000 });
    await expect(
      modal.getByText(/nothing was actually posted to a Teams channel/i),
    ).toBeVisible();
    await modal.getByRole('button', { name: 'Done', exact: true }).click();
  });

  test('Insights & Dashboards: build + save an insight, import into a dashboard, enforce max 3 insights', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);

    await login(page, 'analyst.comms@meridian.dev', 'n_vjJn8aufCyAncfmia13myT');

    // A project must be selected for the builder to offer any fields to map.
    await page.getByLabel('Current project').selectOption({ label: 'Corporate Reputation Monitoring' });
    await page.getByRole('button', { name: 'Open in Insights', exact: true }).click();

    const builder = page.getByTestId('insight-builder-modal');
    await expect(builder).toBeVisible();
    await builder.getByLabel('Name', { exact: true }).fill(INSIGHT_NAME);
    // Chart type defaults to Bar; map its one required "Category" slot to the first
    // available field (arm it, then click the slot — the same click/click affordance the
    // builder's own instructions describe).
    const firstConcept = builder.locator('ul').getByRole('button').first();
    await expect(firstConcept).toBeVisible({ timeout: 15_000 });
    await firstConcept.click();
    await builder.getByRole('button', { name: /Category/ }).click();

    const [createInsightResponse] = await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST' && res.url().endsWith('/insights')),
      builder.getByRole('button', { name: 'Create insight', exact: true }).click(),
    ]);
    const createdInsightBody = (await createInsightResponse.json()) as { success: boolean; data: { id: string } };
    expect(createdInsightBody.success).toBe(true);
    const newInsightId = createdInsightBody.data.id;
    await expect(page.getByText(/^Saved ".*" — find it under Insights\.$/)).toBeVisible({ timeout: 10_000 });

    await page.goto('/insights');
    await expect(page.getByRole('button', { name: INSIGHT_NAME, exact: true })).toBeVisible({ timeout: 15_000 });

    // --- Build a dashboard importing the new insight + one seeded insight this user owns ---
    await page.goto('/dashboards');
    await page.getByRole('button', { name: 'New dashboard', exact: true }).click();
    await page.getByText(INSIGHT_NAME, { exact: true }).click();
    await page.getByText('Key Phrase Cloud', { exact: true }).click();
    await expect(page.getByText('2/3 selected')).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill(DASHBOARD_NAME);
    await page.getByRole('button', { name: 'Create dashboard', exact: true }).click();
    await page.waitForURL(/\/dashboards\/[^/]+$/, { timeout: 20_000 });
    const newDashboardId = page.url().split('/').pop() as string;

    await expect(page.getByRole('heading', { level: 3, name: INSIGHT_NAME })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 3, name: 'Key Phrase Cloud' })).toBeVisible();

    // --- Max-3-insights rule: UI hides "Add insight" once a dashboard already has 3 ... ---
    await page.goto('/dashboards');
    await page.getByRole('link', { name: /Editorial Insights Hub/ }).click();
    await page.waitForURL(/\/dashboards\/[^/]+$/, { timeout: 20_000 });
    const editorialDashboardId = page.url().split('/').pop() as string;
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(3, { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Add insight', exact: true })).toHaveCount(0);

    // ... and the server rejects a direct attempt to attach a 4th with a clear message.
    const analystToken = await apiLogin(request, 'analyst.comms@meridian.dev', 'n_vjJn8aufCyAncfmia13myT');
    const addAttempt = await request.post(`${API_BASE}/dashboards/${editorialDashboardId}/insights`, {
      headers: { Authorization: `Bearer ${analystToken}` },
      data: { insightId: newInsightId },
    });
    expect(addAttempt.status()).toBe(400);
    const addAttemptBody = (await addAttempt.json()) as { success: boolean; code?: string; message?: string };
    expect(addAttemptBody.success).toBe(false);
    expect(addAttemptBody.code).toBe('DASHBOARD_INSIGHT_LIMIT');
    expect(addAttemptBody.message ?? '').toMatch(/at most 3 insights/i);

    // Confirm the seeded dashboard was genuinely untouched by the rejected attempt.
    await page.reload();
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(3);

    // --- cleanup: delete our dashboard, then our insight (blocked while referenced), then
    // revert the project switch ---
    await page.goto(`/dashboards/${newDashboardId}`);
    await page.getByRole('button', { name: 'Dashboard actions' }).click();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete dashboard', exact: true }).click();
    await page.waitForURL('**/dashboards', { timeout: 15_000 });

    await page.goto('/insights');
    const insightDeleteButton = page.getByRole('button', { name: `Delete ${INSIGHT_NAME}` });
    await expect(insightDeleteButton).toBeVisible({ timeout: 15_000 });
    page.once('dialog', (dialog) => void dialog.accept());
    await insightDeleteButton.click();
    await expect(page.getByText('Insight deleted.')).toBeVisible({ timeout: 10_000 });

    await resetCurrentProject(page);
  });
});
