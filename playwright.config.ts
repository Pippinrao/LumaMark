import { defineConfig, devices } from '@playwright/test';

const e2ePort = Number(process.env.LUMAMARK_E2E_PORT ?? '1420');
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const reuseExistingServer =
  process.env.LUMAMARK_E2E_REUSE_SERVER === undefined
    ? !process.env.CI
    : process.env.LUMAMARK_E2E_REUSE_SERVER === '1';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // One CI worker left E2E over the 60m job budget once click timeouts retry.
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: {
    baseURL: e2eBaseUrl,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer,
  },
});
