import { defineConfig, devices } from '@playwright/test';

/** End-to-end tests against a running TransVerse server (`pnpm dev` or `pnpm start` + worker). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    // The UI picks its language from Accept-Language (v2.0); the tests read the Bulgarian text.
    locale: 'bg-BG',
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, locale: 'bg-BG' }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], locale: 'bg-BG' }, grep: /@mobile/ },
  ],
});
