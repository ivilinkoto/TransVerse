/**
 * 1.1.4.1: the long texts players have to read on game screens — the ones to
 * shorten first. `pnpm tsx scripts/ui/long-texts.ts [limit]` lists them by file,
 * longest first. Release notes, help, rules and Discord are left out: there a
 * longer text is the point. tests/ui-texts.test.ts keeps the count from growing.
 */
import { globSync, readFileSync } from 'node:fs';
import ts from 'typescript';

export const TEXT_LIMIT = 140;
const SKIP = [/src\/lib\/game\/releases\.ts$/, /src\/app\/game\/help\//, /src\/app\/(terms|privacy|updates|roadmap)\//, /src\/server\/discord\//, /src\/lib\/game\/(faq|glossary|help)\.ts$/, /src\/server\/mail/, /src\/app\/admin\//, /src\/components\/admin\//, /src\/server\/push\.ts$/, /\.test\.tsx?$/];
const CYR = /[Ѐ-ӿ]/;

export function longTexts(limit = TEXT_LIMIT) {
  const out: { file: string; line: number; text: string }[] = [];
  for (const file of globSync('src/**/*.{ts,tsx}')) {
    if (SKIP.some((r) => r.test(file))) continue;
    const src = readFileSync(file, 'utf8');
    if (!CYR.test(src)) continue;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CYR.test(n.text) && n.text.length > limit) {
        out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text: n.text });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out.sort((a, b) => b.text.length - a.text.length);
}

if (process.argv[1]?.endsWith('long-texts.ts')) {
  const list = longTexts(Number(process.argv[2]) || TEXT_LIMIT);
  for (const t of list) console.log(`${t.text.length}\t${t.file}:${t.line}\t${t.text.slice(0, 90)}…`);
  console.log(`\n${list.length} texts over ${Number(process.argv[2]) || TEXT_LIMIT} characters`);
}
