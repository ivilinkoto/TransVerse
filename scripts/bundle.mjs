// Bundles the worker and maintenance scripts into self-contained ESM files (dist/)
// so production servers need only Node.js — no TypeScript toolchain.
import { build } from 'esbuild';
import path from 'node:path';

const entries = {
  worker: 'src/worker/index.ts',
  migrate: 'scripts/migrate.ts',
  'import-geonames': 'scripts/import-geonames.ts',
  seed: 'scripts/seed.ts',
  'grant-founder': 'scripts/grant-founder.ts',
};

await build({
  entryPoints: entries,
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  alias: { '@': path.resolve('src') },
  // pg-native is an optional peer of pg; argon2 is native and unused by these entry points.
  external: ['pg-native', '@node-rs/argon2', 'next', 'react', 'react-dom'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
