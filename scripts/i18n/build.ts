/**
 * Builds messages/en.json and messages/ru.json from messages/keys.json and
 * the translations in messages/tr/*.tsv (and messages/places.*.json).
 * Checks that each translation keeps the same {0}, {1}… places.
 *
 *   pnpm tsx scripts/i18n/build.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { keyId, loadTranslations } from './extract';

const places = (lang: string): Record<string, string> => (existsSync(`messages/places.${lang}.json`) ? JSON.parse(readFileSync(`messages/places.${lang}.json`, 'utf8')) : {});
const holes = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');

function main() {
  const keys: string[] = JSON.parse(readFileSync('messages/keys.json', 'utf8'));
  const tr = loadTranslations();
  const en: Record<string, string> = { ...places('en') };
  const ru: Record<string, string> = { ...places('ru') };
  let bad = 0;
  let missing = 0;
  for (const k of keys) {
    const v = tr.get(keyId(k));
    if (!v) {
      missing++;
      continue;
    }
    // The key's own spaces and line breaks at the ends are kept (" (не става)", "\nКрай …").
    const lead = /^\s*/.exec(k)![0];
    const trail = /\s*$/.exec(k)![0];
    const wrap = (x: string) => lead + x.trim() + trail;
    for (const [lang, text0, out] of [['en', v.en, en], ['ru', v.ru, ru]] as const) {
      const text = wrap(text0);
      if (holes(text) !== holes(k)) {
        bad++;
        console.warn(`[${lang}] places differ: ${k} → ${text}`);
        continue;
      }
      out[k] = text;
    }
  }
  const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync('messages/en.json', `${JSON.stringify(sorted(en), null, 1)}\n`);
  writeFileSync('messages/ru.json', `${JSON.stringify(sorted(ru), null, 1)}\n`);
  console.log(`keys=${keys.length} missing=${missing} bad=${bad} en=${Object.keys(en).length} ru=${Object.keys(ru).length}`);
}

main();
