/**
 * Builds messages/places.en.json and messages/places.ru.json (v2.0): the
 * English and Russian names of the game's cities, regions, ports and
 * countries, keyed by their Bulgarian name (which the game shows and stores).
 *
 * Names come from the GeoNames alternate names (CC BY 4.0) in data/raw/alt_XX
 * (see docs/GEODATA.md); a city without one keeps its GeoNames name. The
 * countries use the Intl region names. When two places share a Bulgarian
 * name, the bigger one wins.
 *
 *   pnpm tsx scripts/i18n/places.ts && pnpm tsx scripts/i18n/build.ts
 */
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

type Dataset = {
  countries: { code: string; nameEn: string; nameBg: string; geonameId: number }[];
  cities: { id: number; name: string; nameBg: string; country: string; region: string | null; regionBg: string | null }[];
  ports: { id: number; name: string; nameBg: string | null; country: string }[];
};

const RAW = path.resolve('data/raw');
const CYR = /[Ѐ-ӿ]/;
const LANGS = ['en', 'ru'] as const;
type Lang = (typeof LANGS)[number];

async function* lines(file: string) {
  const rl = readline.createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) if (line && !line.startsWith('#')) yield line.split('\t');
}

/** The best alternate name per place and language: preferred, then short, never historic or colloquial. */
async function alternateNames(countries: string[], wanted: Set<number>) {
  const best: Record<Lang, Map<number, { name: string; score: number }>> = { en: new Map(), ru: new Map() };
  for (const code of countries) {
    const file = path.join(RAW, `alt_${code}`, `${code}.txt`);
    if (!existsSync(file)) {
      console.warn(`no alternate names for ${code} (${file})`);
      continue;
    }
    for await (const a of lines(file)) {
      const lang = a[2] as Lang;
      if (!LANGS.includes(lang) || a[7] === '1' || a[6] === '1') continue;
      const id = Number(a[1]);
      if (!wanted.has(id)) continue;
      const score = (a[4] === '1' ? 2 : 0) + (a[5] === '1' ? 0 : 1);
      const prev = best[lang].get(id);
      if (!prev || score > prev.score) best[lang].set(id, { name: a[3]!, score });
    }
  }
  return best;
}

async function main() {
  const data: Dataset = JSON.parse(readFileSync('data/geo/launch-region.json', 'utf8'));
  const codes = data.countries.map((c) => c.code);
  // First-level regions by country and English name → their GeoNames id.
  const regionIds = new Map<string, number>();
  for await (const r of lines(path.join(RAW, 'admin1CodesASCII.txt'))) regionIds.set(`${r[0]!.split('.')[0]}|${r[1]}`, Number(r[3]));
  const regionId = (c: Dataset['cities'][number]) => (c.region ? regionIds.get(`${c.country}|${c.region}`) : undefined);
  const wanted = new Set<number>([...data.cities.map((c) => c.id), ...data.ports.map((p) => p.id), ...data.cities.map(regionId).filter((x): x is number => !!x)]);
  const alt = await alternateNames(codes, wanted);
  const out: Record<Lang, Record<string, string>> = { en: {}, ru: {} };
  // Russian without its own alternate name: a Cyrillic Bulgarian name reads right as it is (Варна, Пловдив).
  const name = (lang: Lang, id: number, bg: string | null, own: string) => alt[lang].get(id)?.name ?? (lang === 'ru' && bg && CYR.test(bg) ? undefined : (alt.en.get(id)?.name ?? own));
  const put = (lang: Lang, bg: string | null | undefined, name: string | undefined) => {
    if (!bg || !name || bg === name || bg in out[lang]) return;
    out[lang][bg] = name;
  };

  for (const lang of LANGS) {
    const region = new Intl.DisplayNames([lang], { type: 'region' });
    for (const c of data.countries) put(lang, c.nameBg, region.of(c.code) ?? c.nameEn);
    // Cities are sorted by population, so the bigger of two namesakes is first.
    for (const c of data.cities) put(lang, c.nameBg, name(lang, c.id, c.nameBg, c.name));
    for (const p of data.ports) put(lang, p.nameBg, name(lang, p.id, p.nameBg, p.name));
  }
  // Regions: GeoNames' own English name; Russian from the alternate names, else the English one.
  for (const c of data.cities) {
    const id = regionId(c);
    put('en', c.regionBg, c.region ?? undefined);
    put('ru', c.regionBg, (id && alt.ru.get(id)?.name.replace(/ (область|край)$/, '')) || (c.regionBg && CYR.test(c.regionBg) ? undefined : c.region) || undefined);
  }

  for (const lang of LANGS) {
    const sorted = Object.fromEntries(Object.entries(out[lang]).sort(([a], [b]) => (a < b ? -1 : 1)));
    writeFileSync(`messages/places.${lang}.json`, `${JSON.stringify(sorted, null, 1)}\n`);
    console.log(`places.${lang}: ${Object.keys(sorted).length}`);
  }
}

void main();
