import { expect, test } from '@playwright/test';

test.describe('auth happy path', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Content Insights' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });

  test('register → home (requires live API)', async ({ page }) => {
    test.skip(!process.env.E2E_LIVE, 'Set E2E_LIVE=1 against a running API+web stack');

    const stamp = Date.now();
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(`e2e-${stamp}@example.com`);
    await page.getByLabel(/password/i).fill('Password123!');
    const orgField = page.getByLabel(/organization/i);
    if (await orgField.count()) {
      await orgField.fill(`E2E Org ${stamp}`);
    }
    await page.getByRole('button', { name: /register|create/i }).click();
    // The app's post-auth home is /articles (root "/" redirects there — see App.tsx),
    // consistent with every other spec's landing-page assertion.
    await expect(page).toHaveURL(/\/articles/, { timeout: 30_000 });
  });
});
