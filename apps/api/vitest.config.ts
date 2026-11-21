import { defineConfig } from 'vitest/config';

// API tests run against the separate test database (TEST_DATABASE_URL), one file at a time.
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/env.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
