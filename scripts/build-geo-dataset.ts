/**
 * Builds data/geo/launch-region.json from raw GeoNames dumps (CC BY 4.0).
 *
 * Dev-only step. Download the raw files first (see docs/GEODATA.md), then:
 *   pnpm tsx scripts/build-geo-dataset.ts
 *
 * The derived dataset is committed so deployments never depend on GeoNames
 * being reachable.
 */
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { LAUNCH_COUNTRIES } from '../src/lib/geo/scope';

const RAW = path.resolve('data/raw');
const OUT = path.resolve('data/geo/launch-region.json');

async function* lines(file: string) {
  const rl = readline.createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) if (line && !line.startsWith('#')) yield line.split('\t');
}

const haversineKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLon - aLon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

async function main() {
  const scope = new Set<string>(LAUNCH_COUNTRIES);
  const bgRegion = new Intl.DisplayNames(['bg'], { type: 'region' });

  // Countries
  const countries = [];
  for await (const c of lines(path.join(RAW, 'countryInfo.txt'))) {
    if (!scope.has(c[0]!)) continue;
    countries.push({
      code: c[0]!,
      iso3: c[1]!,
      nameEn: c[4]!,
      nameBg: bgRegion.of(c[0]!) ?? c[4]!,
      capital: c[5]!,
      continent: c[8]!,
      geonameId: Number(c[16]),
    });
  }

  // Bulgarian alternate names, keyed by geonameid
  const bgNames = new Map<number, { name: string; score: number }>();
  for (const code of scope) {
    for await (const a of lines(path.join(RAW, `alt_${code}`, `${code}.txt`))) {
      if (a[2] !== 'bg' || a[7] === '1' || a[6] === '1') continue; // skip historic & colloquial
      const id = Number(a[1]);
      const score = (a[4] === '1' ? 2 : 0) + (a[5] === '1' ? 0 : 1);
      const prev = bgNames.get(id);
      if (!prev || score > prev.score) bgNames.set(id, { name: a[3]!, score });
    }
  }

  // Administrative regions (first level)
  const regions = new Map<string, { en: string; bg: string }>();
  for await (const r of lines(path.join(RAW, 'admin1CodesASCII.txt'))) {
    const [country] = r[0]!.split('.');
    if (!scope.has(country!)) continue;
    const id = Number(r[3]);
    regions.set(r[0]!, { en: r[1]!, bg: (bgNames.get(id)?.name ?? r[1]!).replace(/^Област /, '') });
  }

  // Cities (population >= 15 000)
  const cities = [];
  for await (const c of lines(path.join(RAW, 'cities15000', 'cities15000.txt'))) {
    if (!scope.has(c[8]!)) continue;
    const id = Number(c[0]);
    const region = regions.get(`${c[8]}.${c[10]}`);
    cities.push({
      id,
      name: c[1]!,
      nameBg: bgNames.get(id)?.name ?? c[1]!,
      country: c[8]!,
      region: region?.en ?? null,
      regionBg: region?.bg ?? null,
      lat: Number(c[4]),
      lon: Number(c[5]),
      population: Number(c[14]),
      timezone: c[17]!,
      featureCode: c[7]!,
    });
  }
  cities.sort((a, b) => b.population - a.population);

  // Ports (feature code PRT) close to a city of 50k+ — the commercially relevant ones.
  const bigCities = cities.filter((c) => c.population >= 50_000);
  const ports = [];
  for (const code of scope) {
    for await (const p of lines(path.join(RAW, `all_${code}`, `${code}.txt`))) {
      if (p[7] !== 'PRT') continue;
      const lat = Number(p[4]);
      const lon = Number(p[5]);
      let nearest: (typeof cities)[number] | undefined;
      let best = Infinity;
      for (const c of bigCities) {
        if (c.country !== code) continue;
        const d = haversineKm(lat, lon, c.lat, c.lon);
        if (d < best) [best, nearest] = [d, c];
      }
      if (!nearest || best > 25) continue;
      const id = Number(p[0]);
      ports.push({ id, name: p[1]!, nameBg: bgNames.get(id)?.name ?? null, country: code, lat, lon, cityId: nearest.id });
    }
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  const dataset = {
    source: 'GeoNames (https://www.geonames.org)',
    license: 'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/',
    note: 'Derived subset: cities with population >= 15 000, first-level regions, ports near major cities.',
    generatedAt: new Date().toISOString().slice(0, 10),
    countries,
    cities,
    ports,
  };
  writeFileSync(OUT, JSON.stringify(dataset));
  const size = readFileSync(OUT).length;
  console.log(`countries=${countries.length} cities=${cities.length} ports=${ports.length} size=${(size / 1024).toFixed(0)} KiB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
