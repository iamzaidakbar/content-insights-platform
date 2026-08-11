import { defineConfig } from 'vitest/config';

/** Opt-in: needs MongoMemoryServer (+ Redis for full auth session). */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['./src/test/setup-env.ts'],
    testTimeout: 60_000,
  },
});
