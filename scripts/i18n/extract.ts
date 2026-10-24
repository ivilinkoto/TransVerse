/**
 * Collects every text the game can show (v2.0) into messages/keys.json:
 * the keys of t('…') calls and the Bulgarian strings of module-level data
 * (labels, goods, cities' names come from the dataset — scripts/i18n/places.ts).
 *
 *   pnpm tsx scripts/i18n/extract.ts            → messages/keys.json + a report of missing translations
 *   pnpm tsx scripts/i18n/extract.ts --batch N  → prints untranslated keys as "id<TAB>text", N at a time
 *
 * Translations live in messages/tr/*.tsv ("id<TAB>English<TAB>Русский"), merged by scripts/i18n/build.ts.
 */
import { createHash } from 'node:crypto';
import { globSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import ts from 'typescript';

const CYR = /[Ѐ-ӿ]/;
const SKIP = [/src\/i18n\//, /src\/components\/i18n\//, /src\/server\/discord\/config\.ts$/, /src\/server\/discord\/layout\.ts$/, /src\/server\/db\/schema\.ts$/];
export const keyId = (key: string) => createHash('sha1').update(key).digest('hex').slice(0, 10);

export function extractKeys(): string[] {
  const keys = new Set<string>();
  for (const file of globSync('src/**/*.{ts,tsx}')) {
    if (SKIP.some((r) => r.test(file))) continue;
    const src = readFileSync(file, 'utf8');
    if (!CYR.test(src)) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const tNames = new Set(['t']);
    for (const m of src.matchAll(/import \{([^}]*)\} from '@\/i18n\/t'/g)) for (const spec of m[1]!.split(',')) {
      const [name, as] = spec.trim().split(/\s+as\s+/);
      if (name === 't') tNames.add(as ?? 't');
    }
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && tNames.has(n.expression.text) && n.arguments[0] && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) {
        keys.add(n.arguments[0].text);
      } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CYR.test(n.text)) {
        // Data strings (shown through tx()): anything with Cyrillic that is not a t() key above.
        const p = n.parent;
        if (!(p && ts.isImportDeclaration(p)) && !(p && ts.isLiteralTypeNode(p))) keys.add(n.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return [...keys].filter((k) => CYR.test(k)).sort();
}

export function loadTranslations(): Map<string, { en: string; ru: string }> {
  const out = new Map<string, { en: string; ru: string }>();
  for (const file of globSync('messages/tr/*.tsv').sort()) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const [id, en, ru] = line.split('\t');
      if (id && en !== undefined && ru !== undefined) out.set(id.trim(), { en: unescape(en), ru: unescape(ru) });
    }
  }
  return out;
}
const unescape = (s: string) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').trim();
export const escapeKey = (s: string) => s.replace(/\t/g, '\\t').replace(/\n/g, '\\n');

function main() {
  const keys = extractKeys();
  writeFileSync('messages/keys.json', `${JSON.stringify(keys, null, 0).replace(/","/g, '",\n"')}\n`);
  const done = loadTranslations();
  const missing = keys.filter((k) => !done.has(keyId(k)));
  const i = process.argv.indexOf('--batch');
  if (i > 0) {
    const n = Number(process.argv[i + 1] ?? 200);
    const from = Number(process.argv[i + 2] ?? 0);
    for (const k of missing.slice(from, from + n)) console.log(`${keyId(k)}\t${escapeKey(k)}`);
    return;
  }
  console.log(`keys=${keys.length} translated=${keys.length - missing.length} missing=${missing.length}${existsSync('messages/places.json') ? ' (+ places)' : ''}`);
}

if (process.argv[1] && /extract\.ts$/.test(process.argv[1])) main();
