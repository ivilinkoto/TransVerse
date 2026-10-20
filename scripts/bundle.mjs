// Bundles the worker and maintenance scripts into self-contained ESM files (dist/)
// so production servers need only Node.js — no TypeScript toolchain.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const entries = {
  worker: 'src/worker/index.ts',
  migrate: 'scripts/migrate.ts',
  'import-geonames': 'scripts/import-geonames.ts',
  seed: 'scripts/seed.ts',
  'grant-founder': 'scripts/grant-founder.ts',
};

const external = ['pg-native', '@node-rs/argon2', 'next', 'react', 'react-dom'];

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
  external,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});

// The release has no node_modules next to dist/: a static import of an external
// package would stop the worker before it starts. Only lazy import() is allowed.
const bad = Object.keys(entries).flatMap((name) => {
  const code = readFileSync(`dist/${name}.js`, 'utf8');
  return external.filter((pkg) => new RegExp(`^import [^;]*from "${pkg}(/[^"]*)?";`, 'm').test(code)).map((pkg) => `${name}.js → ${pkg}`);
});
if (bad.length) {
  console.error(`Static imports of packages that are not in the release:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
