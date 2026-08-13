import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------------------
// Browser/UI coverage for:
//   #7 Admin secure data — Entity mapping -> configure LHS hard/soft -> grant group
//      project + value + concept access -> assign roles.
//   #8 Moderate corpus — Hide bad articles -> review via Hidden filter -> unhide; audit
//      in User Logs.
//
// Live-stack gated exactly like e2e/auth.spec.ts's own "requires live API" test — set
// E2E_LIVE=1 against a running API+web+DB stack to run this file.
//
// Every mutation here either targets disposable state created and reverted within the same
// test (the soft-filter add/remove round-trip; the time-bound role assignment granted then
// ended in the same test) or is provably blocked before it can mutate anything (the
// self-deactivate and non-admin Application-Admin-grant attempts). The seeded demo dataset
// is left exactly as found for the next person to explore it.
// ---------------------------------------------------------------------------------------

const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000/api';

const USERS = {
  admin: { email: 'admin@meridian.dev', password: 'ContentInsights!23' },
  groupAdminComms: { email: 'groupadmin.comms@meridian.dev', password: 'wHycxNexLbag-TTelG1idvkc' },
  analystMarket: { email: 'analyst.market@meridian.dev', password: 'g4Vu1HF8HliBwUzwg4AH5MGd' },
  readOnly: { email: 'readonly@meridian.dev', password: 'sYGlgyXjTOt4Tk1_7m0MasO3' },
} as const;

// authRateLimiter (apps/api/src/middleware/rateLimiters.ts) is a 100-req/min-per-IP budget
// shared across the WHOLE /api/auth surface — when this file runs alongside OTHER e2e spec
// files that also log in concurrently against the same live stack, an occasional 429 on one
// login attempt is expected shared-environment noise, not a product bug. Retries the full
// form submission a couple of times, backing off long enough for the fixed one-minute window
// to roll over, before failing for real.
async function loginUI(page: Page, email: string, password: string): Promise<void> {
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

// Same shared-rate-limit-budget reasoning as loginUI above, for this file's two direct API
// logins (cleanup's admin token, and the read-only API-level hide check).
async function loginAPI(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
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

test.describe('admin secure data + moderation (UI)', () => {
  test.skip(() => !process.env.E2E_LIVE, 'Set E2E_LIVE=1 against a running API+web stack');

  // -------------------------------------------------------------------------------------
  // Workflow #7 — Entity Mapping
  // -------------------------------------------------------------------------------------
  test('Entity Mapping: seeded entries are visible; manual mapping updates status', async ({ page }) => {
    await loginUI(page, USERS.admin.email, USERS.admin.password);
    await page.goto('/admin/entity-mapping');
    await expect(page.getByRole('heading', { name: 'Entity mapping' })).toBeVisible();

    // Idempotent (never overwrites an existing mapping decision, only adds newly-discovered
    // candidates) — safe to run to guarantee the table reflects the current index.
    await page.getByRole('button', { name: 'Sync sources from index' }).click();
    await expect(page.getByText(/Sync complete/)).toBeVisible({ timeout: 20_000 });

    // AdminPage keeps every section mounted at once (CSS-hidden, not unmounted — see its own
    // module comment) — scope to this section's own <section> so `tbody tr` can't pick up
    // rows from the (hidden) Users/Role Assignments/Audit tables mounted alongside it.
    const mappingSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Entity mapping' }) });
    const rows = mappingSection.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);

    const unmappedRow = rows.filter({ hasText: 'Unmapped' }).first();
    await expect(unmappedRow).toBeVisible();
    const upstreamCellText = await unmappedRow.locator('td').first().innerText();
    const upstreamName = (upstreamCellText.split('\n')[0] ?? '').trim();
    expect(upstreamName.length).toBeGreaterThan(0);

    await unmappedRow.getByRole('button', { name: 'Map' }).click();
    // Local entity type "Source" is always available and needs no further lookup (a source's
    // "local id" is just the literal domain string) — the simplest, always-reachable path
    // regardless of which entry we landed on.
    await page.getByLabel('Local entity type').selectOption('source');
    await page.getByPlaceholder('e.g. reuters.com').fill('e2e-test-mapping.example');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByText('Mapping saved.')).toBeVisible();

    const updatedRow = rows.filter({ hasText: upstreamName });
    await expect(updatedRow.getByText('Mapped', { exact: true })).toBeVisible();

    // Cleanup — unmap it again so this entry (and the mapping table as a whole) is left
    // exactly as found for the next person exploring the seeded demo data.
    await updatedRow.getByRole('button', { name: 'Unmap' }).click();
    await expect(page.getByText('Entry unmapped.')).toBeVisible();
    // Once unmapped, both the "Mapped to" cell AND the status pill read exactly "Unmapped" —
    // the status pill (a rounded badge) is the second/last one in DOM order.
    await expect(updatedRow.getByText('Unmapped', { exact: true }).last()).toBeVisible();
  });

  // -------------------------------------------------------------------------------------
  // Workflow #7 — Group Data Access: grants reflect the seed, denial note is visible, and a
  // soft-filter-concept grant round-trips cleanly.
  //
  // Targets Risk & Compliance (not Corporate Communications): per the actual seed data
  // (apps/api/src/scripts/seed.ts's GROUP_DEFS), the ONE configured hard-filter denialNote
  // belongs to Risk & Compliance's Financial Markets Watch grant — Corporate Communications
  // has no denialNote on any of its grants.
  // -------------------------------------------------------------------------------------
  test('Group Data Access: grants reflect the seed; denial note visible; soft-filter round-trip', async ({
    page,
  }) => {
    await loginUI(page, USERS.admin.email, USERS.admin.password);
    await page.goto('/groups');
    await page.getByRole('link', { name: 'Risk & Compliance' }).click();
    await expect(page).toHaveURL(/\/groups\//);

    await page.getByRole('button', { name: 'Data access' }).click();
    await expect(page.getByRole('heading', { name: 'Data access' })).toBeVisible();

    // Projects tab (default) — Risk & Compliance is granted Financial Markets Watch,
    // Corporate Reputation Monitoring, and Public Policy & Regulation, but NOT Aviation &
    // Travel Intelligence.
    async function projectCheckbox(name: string) {
      return page.locator('label', { hasText: name }).locator('input[type="checkbox"]');
    }
    await expect(await projectCheckbox('Financial Markets Watch')).toBeChecked();
    await expect(await projectCheckbox('Corporate Reputation Monitoring')).toBeChecked();
    await expect(await projectCheckbox('Public Policy & Regulation')).toBeChecked();
    await expect(await projectCheckbox('Aviation & Travel Intelligence')).not.toBeChecked();

    // Hard Filter Values tab — the seeded denial note on the Financial Markets Watch grant.
    await page.getByRole('button', { name: 'Hard Filter Values' }).click();
    await expect(
      page.getByText(/Only wire-service sources are cleared for Compliance review/),
    ).toBeVisible();

    // Soft Filter Concepts tab — every soft concept across the group's granted projects is
    // already selected by the seed (nothing sits in "Available" to add outright), so this
    // round-trips the LAST selected entry: remove it (making it available again), save,
    // re-add it from Available, save again — net no change, both code paths exercised.
    await page.getByRole('button', { name: 'Soft Filter Concepts' }).click();
    const selectedList = page
      .locator('p', { hasText: 'Selected & ordered' })
      .locator('xpath=following-sibling::div[1]');
    const availableList = page.locator('p', { hasText: 'Available' }).locator('xpath=following-sibling::div[1]');

    const selectedItems = selectedList.locator(':scope > div');
    const originalCount = await selectedItems.count();
    expect(originalCount).toBeGreaterThan(0);
    const lastItem = selectedItems.nth(originalCount - 1);
    const conceptName = (await lastItem.locator('span').first().innerText()).trim();

    await lastItem.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Save soft filter concepts' }).click();
    await expect(page.getByText('Soft filter concepts saved.')).toBeVisible();

    await availableList.locator('button', { hasText: conceptName }).click();
    await page.getByRole('button', { name: 'Save soft filter concepts' }).click();
    await expect(page.getByText('Soft filter concepts saved.')).toBeVisible();

    const itemsAfter = selectedList.locator(':scope > div');
    await expect(itemsAfter).toHaveCount(originalCount);
    const lastAfterText = (await itemsAfter.nth(originalCount - 1).locator('span').first().innerText()).trim();
    expect(lastAfterText).toBe(conceptName);
  });

  // -------------------------------------------------------------------------------------
  // Workflow #7 — Role assignment: grant a low-stakes, TIME-BOUND Analyst assignment for
  // analyst.market@meridian.dev in a group they're not currently in (Corporate
  // Communications — they're only in Market Research Desk per the seed), then end it.
  // -------------------------------------------------------------------------------------
  test('Role Assignments: grant then end a time-bound Analyst assignment in a new group', async ({
    page,
    request,
  }) => {
    await loginUI(page, USERS.admin.email, USERS.admin.password);
    await page.goto('/admin/members');
    await expect(page.getByRole('heading', { name: 'Role Assignments' })).toBeVisible();

    // AdminPage keeps every section mounted at once (CSS-hidden, not unmounted) — the Users
    // section has its own identically-labeled "Search users by email" input, so scope to
    // this section's own <section> to avoid a strict-mode ambiguity.
    const membersSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Role Assignments' }) });

    await membersSection.getByLabel('Search users by email').fill(USERS.analystMarket.email);
    const row = membersSection.locator('tbody tr', { hasText: USERS.analystMarket.email });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByRole('heading', { name: 'Assign role' })).toBeVisible();

    await page.locator('#assign-role').selectOption({ label: 'Analyst' });
    await page.locator('#assign-scope').selectOption({ label: 'Corporate Communications' });

    const today = new Date().toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.locator('#assign-start').fill(today);
    await page.locator('#assign-end').fill(nextWeek);

    await page.getByRole('button', { name: 'Assign role' }).click();
    await expect(page.getByText('Role assigned.')).toBeVisible();

    // .last(): a rerun of this same test (or a previous run that errored before its own
    // cleanup completed) can leave older, already-ended "Corporate Communications" chips
    // behind — the one just granted is always the newest, i.e. last in DOM order.
    const newChip = row
      .locator('[data-testid="role-assignment-chip"]', { hasText: 'Corporate Communications' })
      .last();
    await expect(newChip).toBeVisible();
    await expect(newChip).toContainText('Analyst');

    // Cleanup, part 1 — "End" is this app's only non-Application-Admin revoke affordance in
    // the UI (it sets endDate to now); exercises the real click-path a User Group Admin would
    // use day to day.
    await newChip.getByRole('button', { name: 'End' }).click();
    await expect(page.getByText('Assignment ended.')).toBeVisible();
    await expect(newChip.locator('span').first()).toHaveClass(/line-through/);

    // Cleanup, part 2 — fully revoke (not just end) EVERY Corporate-Communications-scoped
    // assignment analyst.market holds via a direct API call, so this test stays repeatable
    // and never leaves ended-but-still-present history rows behind for the next run (or the
    // next person exploring the seeded demo data) to trip over.
    const adminToken = await loginAPI(request, USERS.admin.email, USERS.admin.password);
    const adminHeaders = { Authorization: `Bearer ${adminToken}` };

    const groupsRes = await request.get(`${API_BASE}/groups?page=1`, { headers: adminHeaders });
    const groups = (await groupsRes.json()).data.items as { id: string; name: string }[];
    const commsGroupId = groups.find((g) => g.name === 'Corporate Communications')?.id;
    expect(commsGroupId).toBeTruthy();

    const userRes = await request.get(
      `${API_BASE}/users?email=${encodeURIComponent(USERS.analystMarket.email)}&page=1`,
      { headers: adminHeaders },
    );
    const targetUser = (await userRes.json()).data.items[0] as {
      id: string;
      roleAssignments: { id: string; groupId: string | null }[];
    };
    for (const assignment of targetUser.roleAssignments) {
      if (assignment.groupId === commsGroupId) {
        await request.delete(`${API_BASE}/users/${targetUser.id}/role-assignments/${assignment.id}`, {
          headers: adminHeaders,
        });
      }
    }
  });

  // -------------------------------------------------------------------------------------
  // Workflow #7 — "no self-deactivate": the currently logged-in admin's own row is blocked.
  // -------------------------------------------------------------------------------------
  test('Users: the logged-in admin cannot deactivate their own account', async ({ page }) => {
    await loginUI(page, USERS.admin.email, USERS.admin.password);
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

    // Scope to the Users section's own <section> — AdminPage keeps every section mounted at
    // once, and admin@meridian.dev's email also appears in the (hidden) Role Assignments and
    // Audit Log tables' rows.
    const usersSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Users' }) });
    // Plain hasText substring matching would also match "sysadmin@meridian.dev" (it contains
    // "admin@meridian.dev") — require the row to contain an element whose text is EXACTLY
    // this email instead.
    const row = usersSection.locator('tbody tr').filter({ has: page.getByText(USERS.admin.email, { exact: true }) });
    await expect(row).toBeVisible();
    const toggle = row.getByRole('switch');
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('title', /can.?t deactivate your own account/i);
  });

  // -------------------------------------------------------------------------------------
  // Workflow #7 — a non-Application-Admin (User Group Admin, scoped to Corporate
  // Communications) can never grant Application Admin.
  //
  // groupadmin.comms's only role assignment is GROUP-scoped, so her top-level
  // `permissions` array (JWT-denormalized GLOBAL grants only) is empty of admin-cluster
  // permissions — she cannot reach /admin -> Role Assignments at all (RequireAuth blocks
  // it), which is itself part of "the option is unavailable", not a gap in this check. Her
  // real path to assigning roles is her own group's "Add member" (gated by a properly
  // SCOPED permission check) — whose role picker deliberately omits Application Admin
  // entirely (apps/web/src/components/AddMemberModal.tsx), never merely disables it.
  // -------------------------------------------------------------------------------------
  test('User Group Admin cannot assign the Application Admin role', async ({ page }) => {
    await loginUI(page, USERS.groupAdminComms.email, USERS.groupAdminComms.password);

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Forbidden' })).toBeVisible();

    await page.goto('/groups');
    await page.getByRole('link', { name: 'Corporate Communications' }).click();
    await expect(page).toHaveURL(/\/groups\//);

    await page.getByRole('button', { name: 'Add member' }).click();
    await expect(page.getByRole('heading', { name: 'Add member' })).toBeVisible();

    const roleOptionLabels = await page.locator('#member-role option').allTextContents();
    expect(roleOptionLabels.length).toBeGreaterThan(1); // sanity: other roles ARE offered
    expect(roleOptionLabels.some((label) => label.trim() === 'Application Admin')).toBe(false);
  });

  // -------------------------------------------------------------------------------------
  // Workflow #8 — hide -> review via Hidden filter -> unhide; audited with identifying info.
  // -------------------------------------------------------------------------------------
  test('Moderation: hide/unhide an article; hidden filter and audit log reflect it', async ({ page }) => {
    await loginUI(page, USERS.admin.email, USERS.admin.password);
    await page.goto('/articles');

    const firstCard = page.locator('[data-testid="article-card"]').first();
    await expect(firstCard).toBeVisible({ timeout: 15_000 });
    const articleId = await firstCard.getAttribute('data-article-id');
    expect(articleId).toBeTruthy();
    const title = (await firstCard.getByRole('button').first().innerText()).trim();
    expect(title.length).toBeGreaterThan(0);

    await firstCard.getByRole('button', { name: 'Hide' }).click();
    await expect(page.getByText('Article hidden.')).toBeVisible();

    // Disappears from the default (exclude-hidden) view.
    await expect(page.locator(`[data-article-id="${articleId}"]`)).toHaveCount(0);

    // Appears once "Hidden articles" -> "only hidden" is toggled on.
    await page.getByRole('button', { name: 'Hidden articles', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Showing hidden only', exact: true })).toBeVisible();
    const hiddenCard = page.locator(`[data-article-id="${articleId}"]`);
    await expect(hiddenCard).toBeVisible({ timeout: 15_000 });
    await expect(hiddenCard.getByText('Hidden', { exact: true })).toBeVisible();

    // Unhide it and confirm it returns to normal visibility.
    await hiddenCard.getByRole('button', { name: 'Unhide' }).click();
    await expect(page.getByText('Article unhidden.')).toBeVisible();
    await expect(page.locator(`[data-article-id="${articleId}"]`)).toHaveCount(0);

    await page.getByRole('button', { name: 'Showing hidden only', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Hidden articles', exact: true })).toBeVisible();
    await expect(page.locator(`[data-article-id="${articleId}"]`)).toBeVisible({ timeout: 15_000 });

    // User Logs / Audit: both actions show up with the article's own title, not a raw blob.
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();

    await page.getByLabel('Filter by action').selectOption('article.hide');
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Filter by action').selectOption('article.unhide');
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
  });

  // -------------------------------------------------------------------------------------
  // Workflow #8 — Read-Only (no articles:hide anywhere) cannot hide articles: the control is
  // entirely absent in the UI, and the server independently rejects a forced raw request.
  // -------------------------------------------------------------------------------------
  test('Read-Only cannot hide articles: control is absent, and the API independently blocks it', async ({
    page,
    request,
  }) => {
    await loginUI(page, USERS.readOnly.email, USERS.readOnly.password);
    await page.goto('/articles');

    const firstCard = page.locator('[data-testid="article-card"]').first();
    await expect(firstCard).toBeVisible({ timeout: 15_000 });
    const articleId = await firstCard.getAttribute('data-article-id');
    expect(articleId).toBeTruthy();

    await expect(firstCard.getByRole('button', { name: 'Hide' })).toHaveCount(0);
    await expect(firstCard.getByRole('button', { name: 'Unhide' })).toHaveCount(0);

    // Belt-and-suspenders: server-side enforcement can't be bypassed by a crafted request
    // either, even though the UI never offers the control in the first place.
    const token = await loginAPI(request, USERS.readOnly.email, USERS.readOnly.password);

    const hideRes = await request.post(`${API_BASE}/articles/${articleId}/hide`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(hideRes.status()).toBe(403);
  });
});
