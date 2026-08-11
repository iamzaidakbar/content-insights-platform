import { expect, test, type Locator, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------------------
// Covers workflow #3 (Refine & save: Save as Dynamic → globally unique name → Load from
// Saved Queries with full rehydration) and workflow #4 (Channelize: Expose as channel →
// appear in Channels → share deep link → colleague opens if authorized → new-content badge
// clears on view).
//
// Persona choice: the brief says "as an analyst" for the save/load/rename/delete portion, so
// that part runs as analyst.compliance@meridian.dev (a plain Analyst @ Risk & Compliance).
// BUT exposing a saved search as a channel requires 'saved-searches:publish'
// (savedSearch.routes.ts's POST /:id/expose-channel), which the seeded Analyst role does NOT
// grant (see packages/shared/src/permissions.ts's SYSTEM_ROLE_PERMISSIONS — only Application
// Admin and User Group Admin hold it). So the Expose step below switches to
// groupadmin.risk@meridian.dev (User Group Admin @ Risk & Compliance, same group as the
// saved search) — a realistic "analyst creates, group admin publishes" split, not a shortcut
// around the app's real authorization model.
//
// Filter fixture: project "Financial Markets Watch" + taxonomy Organizations = "Continental
// Reserve Bank" + date "Last N days" = 90. Verified against the live seeded data (see the
// research done for this spec) to match a small but non-zero set of articles for Risk &
// Compliance's members even after that group's hard-filter domain restriction (only
// reuters-wire.example / globalfinance-daily.example) is applied — needed so the "new
// articles" channel badge has something real to react to.
//
// All created saved searches / channels are prefixed "E2E — " and deleted via a direct API
// call in afterAll (independent of whatever UI state the run ended in), so the seeded demo
// data is left intact either way.
// ---------------------------------------------------------------------------------------

test.describe('save, load & channelize saved searches', () => {
  test.skip(!process.env.E2E_LIVE, 'Set E2E_LIVE=1 against a running API+web stack');
  // Each test builds on state the previous one left behind (the same saved search /
  // channel, created once and carried through) — serial mode keeps them in file order and
  // stops the rest of the suite after the first failure instead of cascading into confusing,
  // unrelated-looking failures.
  test.describe.configure({ mode: 'serial' });

  const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000/api';

  const RUN_ID = Date.now();
  const SAVED_SEARCH_NAME = `E2E — save-load-${RUN_ID}`;
  const DUPLICATE_NAME_DIFFERENT_CASE = SAVED_SEARCH_NAME.toUpperCase();
  const CHANNEL_NAME = `E2E — channel-${RUN_ID}`;

  const OWNER = { email: 'analyst.compliance@meridian.dev', password: 'Jl9SnI4nHfFLZxfz083kbTKS' };
  const PUBLISHER = { email: 'groupadmin.risk@meridian.dev', password: '3mB5RxSzE6UEKJ7LUM6W0kaD' };
  const OUTSIDER = { email: 'analyst.market@meridian.dev', password: 'g4Vu1HF8HliBwUzwg4AH5MGd' };

  let ownerPage: Page;
  let channelUrl = '';

  // authRateLimiter (apps/api/src/middleware/rateLimiters.ts) is a 100-req/min-per-IP budget
  // shared across the WHOLE /api/auth surface — this file's cumulative login volume, combined
  // with every OTHER e2e spec file logging in against the same live stack from the same IP,
  // can trip it well within a minute regardless of Playwright worker count. A "stuck" login is
  // actually the form re-showing "Too many authentication requests." — retrying after the
  // fixed one-minute window rolls over is what resolves it, not a longer single wait. Same
  // pattern as admin-and-moderation.spec.ts's loginUI.
  async function login(page: Page, email: string, password: string) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await page.goto('/login');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Log in' }).click();
      try {
        await expect(page).toHaveURL(/\/articles/, { timeout: 10_000 });
        return;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        await page.waitForTimeout(20_000);
      }
    }
  }

  function savedSearchRow(page: Page, name: string): Locator {
    return page.locator('tr').filter({ hasText: name });
  }

  // Concept/Project sections start collapsed (FilterPanel.tsx's CollapsibleSection
  // defaultOpen: false) and their local isOpen state resets on every fresh mount (a full
  // page reload, or navigating away from /articles and back) — this expands a section only
  // if its marker isn't already visible, so it's safe to call again after such a reset.
  async function ensureSectionExpanded(panel: Locator, sectionTitle: string, marker: Locator) {
    if (!(await marker.isVisible().catch(() => false))) {
      await panel.getByRole('button', { name: sectionTitle, exact: true }).click();
    }
    await expect(marker).toBeVisible();
  }

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    ownerPage = await context.newPage();
    await login(ownerPage, OWNER.email, OWNER.password);
  });

  test.afterAll(async () => {
    // Everything below is a direct API call, not a UI interaction — robust regardless of
    // which state the run ended in (e.g. a failed assertion mid-test), and avoids racing a
    // fire-and-forget UI mutation against browser-context teardown (selecting "All projects"
    // in the navbar dropdown fires setCurrentProjectMutation but doesn't await its PATCH
    // request, so closing the context right after risked cancelling it mid-flight).
    try {
      const loginRes = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: OWNER.email, password: OWNER.password }),
      });
      const loginBody = (await loginRes.json()) as { data?: { accessToken?: string } };
      const token = loginBody.data?.accessToken;
      if (token) {
        // Delete whatever we created.
        const listRes = await fetch(`${API_BASE}/saved-searches?scope=mine&page=1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const listBody = (await listRes.json()) as {
          data?: { items?: Array<{ id: string; name: string; channelName?: string | null }> };
        };
        const items = listBody.data?.items ?? [];
        const stale = items.filter(
          (item) => item.name === SAVED_SEARCH_NAME || item.channelName === CHANNEL_NAME,
        );
        for (const item of stale) {
          await fetch(`${API_BASE}/saved-searches/${item.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => undefined);
        }

        // Restore analyst.compliance's navbar project selection (was null before this spec ran).
        await fetch(`${API_BASE}/users/me/current-project`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ projectId: null }),
        }).catch(() => undefined);
      }
    } catch {
      // Best-effort cleanup only.
    }

    await ownerPage?.context().close();
  });

  test('applies a distinctive filter combination and saves it as a Dynamic search', async () => {
    const page = ownerPage;
    await page.goto('/articles');
    await page.getByLabel('Current project').selectOption({ label: 'Financial Markets Watch' });

    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Filters' });

    const orgCheckbox = panel.getByRole('checkbox', { name: /Continental Reserve Bank/ });
    await ensureSectionExpanded(panel, 'Organizations', orgCheckbox);
    await orgCheckbox.check();

    await panel.getByRole('radio', { name: 'Last N days', exact: true }).check();
    await panel.getByLabel('Number of days').fill('90');

    await panel.getByRole('button', { name: 'Done', exact: true }).click();

    // Sanity check the combination actually took before we save it.
    await expect(
      page.getByRole('button', { name: 'Organizations: Continental Reserve Bank', exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const modalHeading = page.getByRole('heading', { name: 'Saved Searches' });
    await expect(modalHeading).toBeVisible();
    await page.getByLabel('Name').fill(SAVED_SEARCH_NAME);
    await page.getByRole('button', { name: 'Save search', exact: true }).click();
    // A successful save switches the modal to its Load/browse tab (rather than closing) so
    // the user sees the result immediately — confirm that, then close the modal explicitly.
    await expect(savedSearchRow(page, SAVED_SEARCH_NAME)).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'Close saved searches' }).click();
    await expect(modalHeading).toBeHidden();

    await page.goto('/saved-searches');
    const row = savedSearchRow(page, SAVED_SEARCH_NAME);
    await expect(row).toBeVisible();
    await expect(row.getByText('Dynamic', { exact: true })).toBeVisible();
  });

  test('reloading the app and loading the saved search rehydrates filters exactly', async () => {
    const page = ownerPage;
    await page.goto('/articles');
    await page.reload();

    // A fresh mount resets local filter state — confirm the chip is really gone before
    // proving Load is what brings it back, not leftover React state.
    await expect(
      page.getByRole('button', { name: 'Organizations: Continental Reserve Bank', exact: true }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Load', exact: true }).click();
    const modalHeading = page.getByRole('heading', { name: 'Saved Searches' });
    await expect(modalHeading).toBeVisible();
    await savedSearchRow(page, SAVED_SEARCH_NAME).getByRole('button', { name: 'Load', exact: true }).click();
    await expect(modalHeading).toBeHidden();

    await expect(
      page.getByRole('button', { name: 'Organizations: Continental Reserve Bank', exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Filters' });

    const projectCheckbox = panel.getByRole('checkbox', { name: 'Financial Markets Watch', exact: true });
    await ensureSectionExpanded(panel, 'Project', projectCheckbox);
    await expect(projectCheckbox).toBeChecked();

    const orgCheckbox = panel.getByRole('checkbox', { name: /Continental Reserve Bank/ });
    await ensureSectionExpanded(panel, 'Organizations', orgCheckbox);
    await expect(orgCheckbox).toBeChecked();

    await expect(panel.getByRole('radio', { name: 'Last N days', exact: true })).toBeChecked();
    await expect(panel.getByLabel('Number of days')).toHaveValue('90');

    await panel.getByRole('button', { name: 'Done', exact: true }).click();
  });

  test('saving another search with the same name in a different case is rejected', async () => {
    const page = ownerPage;
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const modalHeading = page.getByRole('heading', { name: 'Saved Searches' });
    await expect(modalHeading).toBeVisible();
    await page.getByLabel('Name').fill(DUPLICATE_NAME_DIFFERENT_CASE);
    await page.getByRole('button', { name: 'Save search', exact: true }).click();

    // Clear inline error, not a silent failure or a crash — a failed save never switches
    // tabs away from "Save current search", so the dialog stays open on the same form.
    // Scoped to <main> because query-client.ts's global MutationCache also auto-toasts every
    // mutation error that doesn't opt out via meta.skipToast (this one doesn't), so the same
    // message briefly appears twice: once as a toast portal (outside <main>) and once as the
    // modal's own inline paragraph (inside <main>, from this component's local `error` state).
    await expect(page.getByRole('main').getByText('A saved search with this name already exists')).toBeVisible();
    await expect(modalHeading).toBeVisible();

    await page.getByRole('button', { name: 'Close saved searches' }).click();
    await expect(modalHeading).toBeHidden();
  });

  test('soft-deleting the saved search frees its name for reuse', async () => {
    const page = ownerPage;
    await page.goto('/saved-searches');
    const row = savedSearchRow(page, SAVED_SEARCH_NAME);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Delete', exact: true }).click();

    const deleteHeading = page.getByRole('heading', { name: 'Delete saved search?' });
    await expect(deleteHeading).toBeVisible();
    await page.getByTestId('confirm-delete-saved-search').click();
    await expect(deleteHeading).toBeHidden();
    await expect(savedSearchRow(page, SAVED_SEARCH_NAME)).toHaveCount(0);

    // Reusing the exact same name now succeeds, proving the soft-delete freed it.
    await page.goto('/articles');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const modalHeading = page.getByRole('heading', { name: 'Saved Searches' });
    await expect(modalHeading).toBeVisible();
    await page.getByLabel('Name').fill(SAVED_SEARCH_NAME);
    await page.getByRole('button', { name: 'Save search', exact: true }).click();
    await expect(savedSearchRow(page, SAVED_SEARCH_NAME)).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'Close saved searches' }).click();

    await page.goto('/saved-searches');
    await expect(savedSearchRow(page, SAVED_SEARCH_NAME)).toBeVisible();
  });

  test('a User Group Admin exposes the saved search as a channel', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, PUBLISHER.email, PUBLISHER.password);

    await page.goto('/saved-searches');
    const row = savedSearchRow(page, SAVED_SEARCH_NAME);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Expose', exact: true }).click();

    const exposeHeading = page.getByRole('heading', { name: 'Expose as a channel' });
    await expect(exposeHeading).toBeVisible();
    await page.getByLabel(/Channel name/).fill(CHANNEL_NAME);
    await page.getByRole('button', { name: 'Expose as channel', exact: true }).click();
    await expect(exposeHeading).toBeHidden();

    await context.close();
  });

  test('the channel appears in Channels with a new-articles indicator that clears on view', async () => {
    const page = ownerPage;
    await page.goto('/channels');
    const row = page.locator('tr').filter({ hasText: CHANNEL_NAME });
    await expect(row).toBeVisible();
    await expect(row.getByText('New', { exact: true })).toBeVisible();

    await row.getByRole('link', { name: CHANNEL_NAME, exact: true }).click();
    await expect(page).toHaveURL(/\/channels\/.+/);
    channelUrl = page.url();

    await expect(page.getByRole('heading', { name: CHANNEL_NAME, exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ results?/)).toBeVisible();

    await page.getByRole('link', { name: /Back to channels/ }).click();
    await expect(page).toHaveURL(/\/channels$/);
    const rowAfterView = page.locator('tr').filter({ hasText: CHANNEL_NAME });
    await expect(rowAfterView.getByText('New', { exact: true })).toHaveCount(0);
  });

  test('an unrelated user gets a friendly not-available message via the deep link', async ({ browser }) => {
    expect(channelUrl, 'the previous test should have captured the channel URL').not.toEqual('');

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, OUTSIDER.email, OUTSIDER.password);

    await page.goto(channelUrl);
    await expect(page.getByRole('heading', { name: "This channel isn't available" })).toBeVisible();
    await expect(page.getByText('It may not exist, or you may not have access to it.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to channels', exact: true })).toBeVisible();

    await context.close();
  });
});
