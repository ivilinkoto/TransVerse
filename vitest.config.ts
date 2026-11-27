import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/test-now.ts'],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/transverse_test',
      ROUTING_PROVIDER: 'approximate',
      SESSION_SECRET: 'test-secret-test-secret-test-secret',
      // Deterministic trips; tests that need road events turn them on themselves.
      ROAD_EVENTS: 'off',
      // No calls to the weather service from the tests.
      WEATHER: 'off',
      // TEST_NOW (tests/test-now.ts): the real start of the run, so the faked clock keeps moving across files.
      TEST_NOW_RUN_START: String(Date.now()),
    },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
