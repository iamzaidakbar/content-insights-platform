import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a running stack (docker-compose or local `pnpm dev`).
 * Skipped in default CI unit jobs — see `.github/workflows/ci.yml`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Every spec file targets the SAME live stack (one API server, one Mongo/ES/Redis set,
  // several files also opening extra browser contexts per test) — under full cross-file
  // parallelism on a dev machine also running the stack's own Docker containers, individual
  // actions/assertions occasionally take noticeably longer than in isolation or in a smaller
  // subset of files, with no actual bug behind it (reproduced: the same assertion, run alone
  // or in a smaller group, is consistently fast). Rather than chase whichever specific
  // assertion happens to be the slowest on a given run, give every expect() in a live run
  // more headroom than Playwright's 5s default; tests that need more than this still set
  // their own explicit timeout.
  expect: { timeout: process.env.E2E_LIVE ? 10_000 : 5_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
