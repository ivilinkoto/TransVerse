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
import { EAST_COUNTRIES, GAME_COUNTRIES } from '../src/lib/geo/scope';
import { fromRomanian, fromRussian, fromUkrainian, isCyrillic } from './geo/bulgarian';

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

function outOfReach(country: string, lat: number, lon: number) {
  if ((country === 'ES' || country === 'PT') && lon < -10) return true;
  if (country === 'ES' && lat < 35.95) return true;
  if (country === 'IT' && lat > 40.68 && lat < 40.8 && lon > 13.82 && lon < 13.97) return true;
  // European Russia only: up to the Urals.
  if (country === 'RU' && lon >= 60) return true;
  return false;
}

/**
 * v2.0: places where freight cannot go now because of the war — Crimea,
 * Sevastopol, the Donetsk, Luhansk and Kherson regions, the south of the
 * Zaporizhzhia region and the east of the Kharkiv region; in Georgia,
 * Abkhazia and South Ossetia. They are left out
 * of the game; it takes no side on the territories (docs/GEODATA.md).
 */
function warZone(country: string, admin1: string, lat: number, lon: number) {
  // Abkhazia and South Ossetia: no crossing for freight from the rest of Georgia.
  if (country === 'GE') return admin1 === '02' || (admin1 === '73' && lat > 42.15 && lon > 43.7 && lon < 44.4);
  if (country !== 'UA') return false;
  if (['05', '08', '11', '14', '20'].includes(admin1)) return true;
  if (admin1 === '26' && lat < 47.6) return true;
  if (admin1 === '07' && lon > 36.9) return true;
  return false;
}
const EAST = new Set<string>(EAST_COUNTRIES);

/** v2.0: the established Bulgarian names GeoNames lacks (by geonameid). */
const BG_NAMES: Record<number, string> = { 703447: 'Киев', 687700: 'Запорожие', 689558: 'Виница', 618069: 'Кишинев' };

async function main() {
  const scope = new Set<string>(GAME_COUNTRIES);
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
  // v2.0: the Russian and Ukrainian names in the east, for places without a Bulgarian one.
  const local = { ru: new Map<number, { name: string; score: number }>(), uk: new Map<number, { name: string; score: number }>() };
  for (const code of scope) {
    for await (const a of lines(path.join(RAW, `alt_${code}`, `${code}.txt`))) {
      if (a[7] === '1' || a[6] === '1') continue; // skip historic & colloquial
      const lang = a[2];
      const into = lang === 'bg' ? bgNames : EAST.has(code) && (lang === 'ru' || lang === 'uk') ? local[lang] : null;
      if (!into || (lang !== 'bg' && !isCyrillic(a[3]!))) continue;
      const id = Number(a[1]);
      const score = (a[4] === '1' ? 2 : 0) + (a[5] === '1' ? 0 : 1);
      const prev = into.get(id);
      if (!prev || score > prev.score) into.set(id, { name: a[3]!, score });
    }
  }
  /** The Bulgarian name of a place: GeoNames' own, else spelled from the Ukrainian / Russian / Romanian name (v2.0). */
  const bulgarian = (id: number, country: string, name: string): string | undefined => {
    const own = BG_NAMES[id] ?? bgNames.get(id)?.name;
    if (own || !EAST.has(country)) return own;
    const uk = local.uk.get(id)?.name;
    if (country === 'UA' && uk) return fromUkrainian(uk);
    const ru = local.ru.get(id)?.name;
    if (country === 'MD') return fromRomanian(name);
    return ru ? fromRussian(ru) : undefined;
  };

  // Administrative regions (first level)
  const regions = new Map<string, { en: string; bg: string }>();
  for await (const r of lines(path.join(RAW, 'admin1CodesASCII.txt'))) {
    const [country] = r[0]!.split('.');
    if (!scope.has(country!)) continue;
    const id = Number(r[3]);
    const en = r[1]!.replace(/^Raionul /, '').replace(/ (Municipality|District)$/, '');
    regions.set(r[0]!, { en: r[1]!, bg: (bulgarian(id, country!, en) ?? r[1]!).replace(/^Област /, '').replace(/ [Оо]бласт[ь]?$/, '') });
  }

  // Cities (population >= 15 000)
  const cities = [];
  for await (const c of lines(path.join(RAW, 'cities15000', 'cities15000.txt'))) {
    if (!scope.has(c[8]!)) continue;
    // Places a truck cannot reach from the mainland of the game (no ferry line for them): the Canaries, Madeira, the Azores, Ceuta, Melilla, Ischia.
    if (outOfReach(c[8]!, Number(c[4]), Number(c[5]))) continue;
    if (warZone(c[8]!, c[10]!, Number(c[4]), Number(c[5]))) continue;
    // v2.0 countries: no historical or abandoned places.
    if (EAST.has(c[8]!) && (c[7] === 'PPLH' || c[7] === 'PPLQ')) continue;
    const id = Number(c[0]);
    const region = regions.get(`${c[8]}.${c[10]}`);
    cities.push({
      id,
      name: c[1]!,
      nameBg: bulgarian(id, c[8]!, c[1]!) ?? c[1]!,
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
      ports.push({ id, name: p[1]!, nameBg: bulgarian(id, code, p[1]!) ?? null, country: code, lat, lon, cityId: nearest.id });
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
