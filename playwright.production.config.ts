import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/production-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:1421',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-production',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 1421',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: false,
  },
});
