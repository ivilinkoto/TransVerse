/**
 * Codemod (v2.0): wraps the Bulgarian text of the source in t() so it can be
 * shown in the player's language. Bulgarian stays the source and the key.
 *
 *   pnpm tsx scripts/i18n/wrap.ts [files...]   (default: all of src/)
 *
 * - Text inside functions and JSX → t('…', values…); `${x}` becomes {0}.
 * - JSX text runs with expressions become one message: "Доставени {0} от {1}".
 * - Module-level constants stay as they are (shown through tx() where used).
 * - Not touched: comparisons, object keys, imports, regexes, sql``, DB writes
 *   (.values/.set), console, identifier-like strings (Discord channel names…).
 * - Notification text becomes a function so it is written in the recipient's language.
 * - Pages and layouts start with `await initLocale()`; `metadata` becomes generateMetadata.
 * Idempotent: running it twice changes nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { globSync } from 'node:fs';

const ROOT = path.resolve('src');
const CYR = /[Ѐ-ӿ]/;
/** Files whose Bulgarian strings are identifiers (Discord structure) or the i18n machinery. */
const SKIP_FILES = [/^i18n\//, /^server\/discord\/config\.ts$/, /^server\/discord\/layout\.ts$/, /^server\/db\/schema\.ts$/];
const DISPLAY_ATTRS = new Set(['title', 'label', 'placeholder', 'aria-label', 'alt', 'subtitle', 'help', 'description', 'text', 'confirm', 'ariaLabel', 'heading', 'hint', 'caption', 'empty', 'message', 'tooltip']);
const NO_TOUCH_ATTRS = new Set(['className', 'href', 'src', 'key', 'id', 'name', 'type', 'value', 'defaultValue', 'htmlFor', 'role', 'rel', 'target', 'method', 'action', 'd', 'viewBox', 'fill', 'stroke', 'field', 'endpoint', 'pattern']);
const IDENTITY_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'has', 'get', 'set', 'delete', 'split', 'replace', 'replaceAll', 'match', 'test', 'search', 'localeCompare', 'padStart', 'padEnd', 'values']);
const NO_TOUCH_CALLS = new Set(['addChronicle', 'RegExp', 'require', 'eq', 'ne', 'like', 'ilike', 'inArray', 'sql', 'fail_code', 'Symbol', 'describe', 'it', 'test', 'expect']);
const NOTIFY_CALLS: Record<string, number[]> = { notify: [3, 4], notifyMembers: [3, 4] };

const hasCyr = (s: string) => CYR.test(s);

function inFunction(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p) || ts.isClassStaticBlockDeclaration(p)) return true;
  }
  return false;
}

/** React's rule for JSX text: lines trimmed, blank lines dropped, joined with a space. */
function jsxTextValue(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((l, i) => {
    if (/[^ \t]/.test(l)) lastNonEmpty = i;
  });
  let out = '';
  lines.forEach((line0, i) => {
    let line = line0.replace(/\t/g, ' ');
    if (i !== 0) line = line.replace(/^ +/, '');
    if (i !== lines.length - 1) line = line.replace(/ +$/, '');
    if (line) {
      if (i !== lastNonEmpty) line += ' ';
      out += line;
    }
  });
  return decodeEntities(out);
}

const ENTITIES: Record<string, string> = { nbsp: '\u00a0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', times: '×', middot: '·', rarr: '→', larr: '←', deg: '°', euro: '€' };
const decodeEntities = (s: string) => s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m)));

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;

function calleeName(call: ts.CallExpression): string | null {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return null;
}

export function transformSource(file: string, src: string): { text: string; changes: number } {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const isClient = /^\s*['"]use client['"]/.test(src);
  // A file with its own `t` / `tx` (a loop variable, a parameter…) uses other names for ours.
  const declared = new Set<string>();
  const collect = (n: ts.Node) => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n) || ts.isFunctionDeclaration(n) || ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n)) && n.name && ts.isIdentifier(n.name)) declared.add(n.name.text);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const alreadyOurs = /import \{[^}]*\} from '@\/i18n\/t'/.test(src);
  const pick = (base: string, alts: string[]) => (alreadyOurs || !declared.has(base) ? base : alts.find((a) => !declared.has(a))!);
  const T = pick('t', ['tr', 'tt', 'tl']);
  const TX = pick('tx', ['txl', 'txt2']);
  let changes = 0;
  let needT = false;
  let needTx = false;
  let needIntl = false;

  /** Is this Cyrillic literal a piece of text to translate here? */
  function translatable(node: ts.Node): boolean {
    const p = node.parent;
    if (!p) return false;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return false;
    if (ts.isLiteralTypeNode(p)) return false;
    if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isEnumMember(p)) && p.name === node) return false;
    if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return false;
    if (ts.isCaseClause(p)) return false;
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return false;
    if (ts.isTaggedTemplateExpression(p)) return false;
    if (ts.isJsxAttribute(p)) {
      const name = p.name.getText(sf);
      if (NO_TOUCH_ATTRS.has(name) || name.startsWith('data-')) return false;
    }
    // Arguments of identity-like calls (includes, Map.get, eq …).
    for (let a: ts.Node | undefined = node; a && a !== sf; a = a.parent) {
      const up: ts.Node | undefined = a.parent;
      if (!up) break;
      if (ts.isCallExpression(up) && up.arguments.includes(a as ts.Expression)) {
        const name = calleeName(up);
        if (name && (IDENTITY_METHODS.has(name) || NO_TOUCH_CALLS.has(name))) return false;
        if (name && /^(log|warn|error|info|debug)$/.test(name) && ts.isPropertyAccessExpression(up.expression) && up.expression.expression.getText(sf) === 'console') return false;
        if (alreadyOurs && (name === T || name === TX)) return false;
        break;
      }
      if (ts.isNewExpression(up) && up.expression.getText(sf) === 'RegExp') return false;
      // Values written to the database stay Bulgarian (shared data, shown with tx()).
      if (ts.isObjectLiteralExpression(up)) {
        const call = up.parent;
        if (call && ts.isCallExpression(call) && ['values', 'set', 'onConflictDoUpdate'].includes(calleeName(call) ?? '')) return false;
        if (call && ts.isArrayLiteralExpression(call) && call.parent && ts.isCallExpression(call.parent) && calleeName(call.parent) === 'values') return false;
      }
      if (ts.isStatement(up) || ts.isFunctionLike(up) || ts.isJsxElement(up) || ts.isJsxSelfClosingElement(up)) break;
    }
    return inFunction(node) || ts.isJsxAttribute(p) || !!findJsxAncestor(node);
  }

  function findJsxAncestor(node: ts.Node) {
    for (let p = node.parent; p; p = p.parent) if (ts.isJsxElement(p) || ts.isJsxFragment(p) || ts.isJsxSelfClosingElement(p)) return p;
    return null;
  }

  function tCall(key: string, args: string[]) {
    needT = true;
    changes++;
    return `${T}(${quote(key)}${args.length ? `, ${args.join(', ')}` : ''})`;
  }

  /** A template literal → t('… {0} …', …). */
  function templateToT(node: ts.TemplateExpression): string {
    let key = node.head.text;
    const args: string[] = [];
    node.templateSpans.forEach((span, i) => {
      key += `{${i}}` + span.literal.text;
      args.push(rewrite(span.expression));
    });
    return tCall(key, args);
  }

  const isDisplayExpr = (e: ts.Expression) => ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e);

  /** JSX children: runs of text and simple expressions become one message. */
  function rewriteChildren(children: ts.NodeArray<ts.JsxChild>): string {
    const out: string[] = [];
    let run: ts.JsxChild[] = [];
    const simple = (c: ts.JsxChild) => ts.isJsxText(c) || (ts.isJsxExpression(c) && !!c.expression && !c.dotDotDotToken && !containsJsx(c.expression));
    const flush = () => {
      if (!run.length) return;
      const textOf = run.map((c) => (ts.isJsxText(c) ? jsxTextValue(c.text) : '')).join('');
      const exprs = run.filter((c): c is ts.JsxExpression => ts.isJsxExpression(c));
      if (!hasCyr(textOf)) {
        for (const c of run) out.push(rewriteChild(c));
      } else {
        let key = '';
        const args: string[] = [];
        let firstText = true;
        for (const c of run) {
          if (ts.isJsxText(c)) {
            const v = jsxTextValue(c.text);
            key += v;
            if (firstText) firstText = false;
          } else {
            key += `{${args.length}}`;
            args.push(rewrite((c as ts.JsxExpression).expression!));
          }
        }
        void exprs;
        const lead = /^\s+/.test(key) ? ' ' : '';
        const trail = /\s+$/.test(key) ? ' ' : '';
        const body = key.trim();
        // the original whitespace (newlines/indent) before and after the run is kept
        const first = run[0]!;
        const last = run[run.length - 1]!;
        const rawFirst = ts.isJsxText(first) ? first.text : '';
        const rawLast = ts.isJsxText(last) ? last.text : '';
        const preWs = rawFirst.match(/^\s*/)?.[0] ?? '';
        const postWs = rawLast.match(/\s*$/)?.[0] ?? '';
        const keepPre = preWs.includes('\n') ? preWs : '';
        const keepPost = postWs.includes('\n') ? postWs : '';
        out.push(`${keepPre}${lead ? "{' '}" : ''}{${tCall(body, args)}}${trail ? "{' '}" : ''}${keepPost}`);
      }
      run = [];
    };
    for (const c of children) {
      if (simple(c)) run.push(c);
      else {
        flush();
        out.push(rewriteChild(c));
      }
    }
    flush();
    return out.join('');
  }

  function containsJsx(n: ts.Node): boolean {
    let found = false;
    const visit = (x: ts.Node) => {
      if (found) return;
      if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x) || ts.isArrowFunction(x) || ts.isFunctionExpression(x)) found = true;
      else ts.forEachChild(x, visit);
    };
    visit(n);
    return found;
  }

  function rewriteChild(c: ts.JsxChild): string {
    if (ts.isJsxText(c)) return src.slice(c.pos, c.end);
    const lead = src.slice(c.pos, c.getStart(sf));
    if (ts.isJsxExpression(c) && c.expression && !c.dotDotDotToken && isDisplayExpr(c.expression) && !containsJsx(c.expression)) {
      needTx = true;
      changes++;
      return `${lead}{${TX}(${rewrite(c.expression)})}`;
    }
    return lead + rewrite(c);
  }

  function rewrite(node: ts.Node): string {
    const full = node.getText(sf);
    const mayWork = hasCyr(full) || full.includes("'bg-BG'") || (kind === ts.ScriptKind.TSX && full.includes('.'));
    if (!mayWork) return full;

    // Already translated.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && [T, TX, 't', 'tx'].includes(node.expression.text) && alreadyOurs) return full;

    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === 'bg-BG' && inFunction(node)) {
      // 'bg-BG' inside a function (toLocaleString, Intl): the player's language
      needIntl = true;
      changes++;
      return 'intlLocale()';
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && hasCyr(node.text) && translatable(node)) {
      const p = node.parent;
      const call = tCall(node.text, []);
      return p && ts.isJsxAttribute(p) ? `{${call}}` : call;
    }
    if (ts.isTemplateExpression(node) && (hasCyr(node.head.text) || node.templateSpans.some((s) => hasCyr(s.literal.text))) && translatable(node)) return templateToT(node);

    if ((ts.isJsxElement(node) || ts.isJsxFragment(node))) {
      const open = ts.isJsxElement(node) ? rewrite(node.openingElement) : node.openingFragment.getText(sf);
      const close = ts.isJsxElement(node) ? node.closingElement.getText(sf) : node.closingFragment.getText(sf);
      return open + rewriteChildren(node.children) + close;
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && DISPLAY_ATTRS.has(node.name.getText(sf)) && isDisplayExpr(node.initializer.expression)) {
      needTx = true;
      changes++;
      return `${node.name.getText(sf)}={${TX}(${rewrite(node.initializer.expression)})}`;
    }
    // Notification text: written later, in the recipient's language.
    if (ts.isCallExpression(node) && NOTIFY_CALLS[calleeName(node) ?? '']) {
      const idx = NOTIFY_CALLS[calleeName(node)!]!;
      const parts: string[] = [];
      let pos = node.getStart(sf);
      const pieces: string[] = [];
      for (const child of node.getChildren(sf)) {
        pieces.push(src.slice(pos, child.getStart(sf)));
        if (child.kind === ts.SyntaxKind.SyntaxList) {
          let p2 = child.getStart(sf);
          let argIndex = 0;
          let inner = '';
          for (const a of child.getChildren(sf)) {
            inner += src.slice(p2, a.getStart(sf));
            if (a.kind === ts.SyntaxKind.CommaToken) inner += a.getText(sf);
            else {
              const r = rewrite(a);
              inner += idx.includes(argIndex) && (hasCyr(a.getText(sf)) || /\bt\(/.test(r)) && !ts.isArrowFunction(a) && !ts.isFunctionExpression(a) ? `() => ${r.trimStart().startsWith('{') ? `(${r})` : r}` : r;
              argIndex++;
            }
            p2 = a.getEnd();
          }
          inner += src.slice(p2, child.getEnd());
          pieces.push(inner);
        } else pieces.push(rewrite(child));
        pos = child.getEnd();
      }
      void parts;
      return pieces.join('') + src.slice(pos, node.getEnd());
    }
    const kids = node.getChildren(sf);
    if (!kids.length) return full;
    let out = '';
    let pos = node.getStart(sf);
    for (const k of kids) {
      out += src.slice(pos, k.getStart(sf));
      out += rewrite(k);
      pos = k.getEnd();
    }
    out += src.slice(pos, node.getEnd());
    return out;
  }

  if (SKIP_FILES.some((r) => r.test(rel))) return { text: src, changes: 0 };
  let text = src.slice(0, sf.getStart(sf)) + rewrite(sf) + src.slice(sf.getEnd());

  // Pages and layouts: the request's language first; static metadata becomes generateMetadata.
  const isPage = /^app\/(.+\/)?(page|layout|template|not-found)\.tsx$/.test(rel) && !isClient;
  let needInit = false;
  if (isPage) {
    const before = text;
    text = text.replace(/export default async function (\w+)\(([^)]*)\)(?:: [^{]+)? \{\n(?!\s*await initLocale\(\);)/, (m) => `${m}  await initLocale();\n`);
    text = text.replace(/export default function (\w+)\(([^)]*)\)(?:: [^{]+)? \{\n(?!\s*await initLocale\(\);)/, (m) => `${m.replace('export default function', 'export default async function')}  await initLocale();\n`);
    text = text.replace(/export const metadata(?:: Metadata)? = (\{[^\n]*\});\n/, (_m, obj: string) => {
      const translated = obj.replace(/(title|description): '([^']*[Ѐ-ӿ][^']*)'/g, (_x, k: string, v: string) => `${k}: ${T}(${quote(v)})`);
      needT = needT || translated !== obj;
      return `export async function generateMetadata(): Promise<Metadata> {\n  await initLocale();\n  return ${translated};\n}\n`;
    });
    needInit = text !== before;
    if (needInit) changes++;
  }

  if (!changes) return { text: src, changes: 0 };
  const imports: string[] = [];
  const have = (name: string, from: string) => new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '${from.replace(/[/@]/g, (c) => `\\${c}`)}'`).test(text);
  const spec = (name: string, as: string) => (name === as ? name : `${name} as ${as}`);
  const tNames = [needT && !have('t', '@/i18n/t') ? spec('t', T) : null, needTx && !have('tx', '@/i18n/t') ? spec('tx', TX) : null, needIntl && !have('intlLocale', '@/i18n/t') ? 'intlLocale' : null].filter(Boolean);
  if (tNames.length) imports.push(`import { ${tNames.join(', ')} } from '@/i18n/t';`);
  if (needInit && !have('initLocale', '@/i18n/server')) imports.push("import { initLocale } from '@/i18n/server';");
  if (isPage && /Promise<Metadata>/.test(text) && !/import (type )?\{[^}]*\bMetadata\b[^}]*\} from 'next'/.test(text)) imports.push("import type { Metadata } from 'next';");
  if (imports.length) {
    const sf2 = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    const lastImport = [...sf2.statements].filter(ts.isImportDeclaration).pop();
    const at = lastImport ? lastImport.getEnd() : (sf2.statements[0] && ts.isExpressionStatement(sf2.statements[0]) && ts.isStringLiteral(sf2.statements[0].expression) ? sf2.statements[0].getEnd() : 0);
    text = text.slice(0, at) + (at ? '\n' : '') + imports.join('\n') + (at ? '' : '\n') + text.slice(at);
  }
  return { text, changes };
}

function main() {
  const args = process.argv.slice(2);
  const files = args.length ? args.map((f) => path.resolve(f)) : globSync('src/**/*.{ts,tsx}').map((f) => path.resolve(f));
  let total = 0;
  let touched = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const { text, changes } = transformSource(f, src);
    if (changes && text !== src) {
      writeFileSync(f, text);
      total += changes;
      touched++;
    }
  }
  console.log(`files=${touched} changes=${total}`);
}

if (process.argv[1] && /wrap\.ts$/.test(process.argv[1])) main();
