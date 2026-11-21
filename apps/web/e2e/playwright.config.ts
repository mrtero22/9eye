import { defineConfig } from '@playwright/test';

// Browser tests of the Templates page against the local app (API 4100, web 4101). They reuse
// running dev servers or start them. Each test rebuilds a throw-away company (e2e/fixture.ts).
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: '../../../.cache/e2e-results',
  use: { baseURL: 'http://127.0.0.1:4101', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: [
    { command: 'npm run dev:api', cwd: '../../..', url: 'http://127.0.0.1:4100/api/health', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev:web', cwd: '../../..', url: 'http://127.0.0.1:4101', reuseExistingServer: true, timeout: 60_000 },
  ],
});
