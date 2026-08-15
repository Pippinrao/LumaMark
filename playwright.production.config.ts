import { defineConfig, devices } from '@playwright/test';

const productionE2ePort = Number(
  process.env.LUMAMARK_PRODUCTION_E2E_PORT ?? '1421',
);
const productionE2eBaseUrl = `http://127.0.0.1:${productionE2ePort}`;

export default defineConfig({
  testDir: './tests/production-e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: productionE2eBaseUrl,
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
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${productionE2ePort}`,
    url: productionE2eBaseUrl,
    reuseExistingServer: false,
  },
});
