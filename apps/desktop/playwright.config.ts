import { defineConfig } from '@playwright/test';

// Every launch is hidden by default: e2e/hidden.ts adds the --e2e-hidden switch to each start of the app (BOWERLOOM_E2E_SHOW=1 turns it off).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'off' },
});
