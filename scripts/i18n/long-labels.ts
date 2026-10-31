import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 1.1.4.2: short labels (buttons, tabs, chips) whose English or Russian is much
 * longer than the Bulgarian — they are the ones that break a button on a phone.
 * `pnpm tsx scripts/i18n/long-labels.ts` lists them; tests/i18n-labels.test.ts keeps the count from growing.
 */
export const SHORT = 18;
export const RATIO = 1.8;

export function longLabels(root = process.cwd()) {
  const out: { key: string; locale: 'en' | 'ru'; text: string }[] = [];
  for (const locale of ['en', 'ru'] as const) {
    const messages = JSON.parse(readFileSync(join(root, 'messages', `${locale}.json`), 'utf8')) as Record<string, string>;
    for (const [key, text] of Object.entries(messages)) {
      if (key.length > SHORT || key.includes('{') || key.includes('\n')) continue;
      if (text.length > Math.max(key.length * RATIO, key.length + 10)) out.push({ key, locale, text });
    }
  }
  return out;
}

if (process.argv[1]?.endsWith('long-labels.ts')) {
  const list = longLabels();
  for (const l of list) console.log(`${l.locale}\t${l.key}\t→ ${l.text}`);
  console.log(`${list.length} long labels`);
}
