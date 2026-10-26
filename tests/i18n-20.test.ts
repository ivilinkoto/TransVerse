import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import ru from '../messages/ru.json';
import { extractKeys } from '../scripts/i18n/extract';
import { withLocale } from '@/i18n/als';
import { t, tx } from '@/i18n/t';
import { duration, money } from '@/lib/format';

const placeholders = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');

describe('v2.0 languages', () => {
  it('every text in the game has an English and a Russian translation with the same placeholders', () => {
    const keys = extractKeys();
    const missing = keys.filter((k) => !(k in en) || !(k in ru));
    expect(missing).toEqual([]);
    const bad = keys.filter((k) => placeholders(k) !== placeholders((en as Record<string, string>)[k]!) || placeholders(k) !== placeholders((ru as Record<string, string>)[k]!));
    expect(bad).toEqual([]);
  });

  it('t() and tx() follow the language; Bulgarian stays the source', () => {
    expect(t('{0} д {1} ч', 2, 3)).toBe('2 д 3 ч');
    expect(withLocale('en', () => duration(185))).toBe('3 h 05 min');
    expect(withLocale('ru', () => t('Камиони'))).toBe('Грузовики');
    expect(withLocale('en', () => tx('Непознат текст'))).toBe('Непознат текст');
    expect(withLocale('en', () => money(1_234_00))).toBe('1,234 lv');
  });

  it('no t() runs when a module loads: there it would always be Bulgarian', () => {
    const found: string[] = [];
    for (const file of execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'").toString().trim().split('\n')) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('i18n/t')) continue;
      const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      // The local names of t (t, tr…) imported from the catalog.
      const names = new Set<string>();
      for (const s of src.statements) {
        if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.moduleSpecifier.text.endsWith('i18n/t')) continue;
        const bindings = s.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) if ((e.propertyName ?? e.name).text === 't') names.add(e.name.text);
      }
      const visit = (node: ts.Node, inFunction: boolean) => {
        const fn = inFunction || ts.isFunctionLike(node);
        if (!fn && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) found.push(`${file}:${src.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        ts.forEachChild(node, (c) => visit(c, fn));
      };
      if (names.size) visit(src, false);
    }
    expect(found).toEqual([]);
  });
});
