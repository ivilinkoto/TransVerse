import { vi } from 'vitest';

/**
 * `TEST_NOW=2026-12-04T12:00:00+02:00 pnpm test` runs the suite as if it were that moment
 * (only `Date` is faked; it keeps ticking), to find the tests that break on a date before
 * it comes (a release, a season, a sale). The database's own now() stays real.
 */
if (process.env.TEST_NOW) {
  // Each file starts where the run is (not at TEST_NOW again), so names and keys made from the time stay unique.
  const ran = Date.now() - Number(process.env.TEST_NOW_RUN_START ?? Date.now());
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(Date.parse(process.env.TEST_NOW) + Math.max(0, ran)), shouldAdvanceTime: true });
}
