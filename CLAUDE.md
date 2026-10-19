# Notes for contributors and AI assistants

- Stack: Next.js 16 (App Router) + TypeScript strict + Tailwind v4, PostgreSQL 16 + Drizzle, Zod, MapLibre. pnpm.
- Before committing: `pnpm typecheck && pnpm lint && pnpm test` (tests need Postgres at TEST_DATABASE_URL, default postgres://postgres@localhost:5432/transverse_test). E2E: `pnpm e2e` against a running dev server + worker.
- The server is authoritative: never compute rewards, balances or ownership on the client. All player commands go through `src/app/api/game/action/route.ts`.
- Money moves only via `post()` in `src/server/game/finance.ts` with a unique idempotency key.
- Game time is real time; deliveries are schedules (`src/lib/game/schedule.ts`). Pages must not call `Date.now()` during render — use `now` from `gameContext()`.
- Geography must stay real (GeoNames ids, real coordinates). Simulated economy data must be labelled as game data in the UI. Routes come only through `src/server/geo/routing.ts`.
- Vehicle illustrations live in `src/components/vehicles` (1 unit = 1 cm, ground at y = 0). Brands are fictional; never add real trademarks or copied assets.
- UI text is Bulgarian. Keep docs in `docs/` in sync with behaviour.
- Every game update gets a version, a name and release notes in `src/lib/game/releases.ts` (Bulgarian); keep them in sync with what the update ships.
- New player-facing features are registered in `FEATURES` (`src/lib/game/features.ts`) under their release version and gated with `useFeature` / `gameContext().features` / `requireFeature` / `featureFor`: staff-only until the release's `publishedAt`. Balance changes and bug fixes are not gated.
