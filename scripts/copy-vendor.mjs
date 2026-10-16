// Copies browser assets that must be served as plain files (MapLibre's Web Worker).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'));
mkdirSync('public/vendor', { recursive: true });
copyFileSync(path.join(dist, 'maplibre-gl-worker.mjs'), 'public/vendor/maplibre-gl-worker.mjs');
console.log('vendor assets copied');
