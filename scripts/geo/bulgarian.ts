/**
 * Bulgarian spellings for places that have no Bulgarian name in GeoNames
 * (v2.0, the east of Europe): from the Russian, Ukrainian or Romanian name,
 * by the usual Bulgarian rules for those languages (Нижний Новгород →
 * Нижни Новгород, Рязань → Рязан, Хмельницький → Хмелницки, Soroca → Сорока).
 */

/** Russian → Bulgarian. */
export function fromRussian(name: string): string {
  return name
    .split(/(\s+|-)/)
    .map((w) =>
      w
        .replace(/(ий|ый)$/u, 'и')
        .replace(/(ИЙ|ЫЙ)$/u, 'И')
        .replace(/ые$/u, 'и')
        .replace(/ая$/u, 'а')
        .replace(/ое$/u, 'о')
        .replace(/ье$/u, 'ие')
        .replace(/^Республика$/u, 'Република'),
    )
    .join('')
    .replace(/ь([оО])/gu, 'ь$1')
    .replace(/ь([яюЯЮ])/gu, '$1')
    .replace(/ь([еЕ])/gu, '$1')
    .replace(/ь(?![оО])/gu, '')
    .replace(/ъ/gu, '')
    .replace(/ы/gu, 'и')
    .replace(/э/gu, 'е')
    .replace(/Э/gu, 'Е')
    .replace(/(^|[\s-]|[аеиоуъюя])ё/gu, '$1йо')
    .replace(/ё/gu, 'ьо')
    .replace(/Ё/gu, 'Йо');
}

/** Ukrainian → Bulgarian. */
export function fromUkrainian(name: string): string {
  return name
    .replace(/['’ʼ]/gu, '')
    .split(/(\s+|-)/)
    .map((w) => w.replace(/(ий|ій)$/u, 'и').replace(/ська$/u, 'ска').replace(/ське$/u, 'ско'))
    .join('')
    .replace(/(^|[\s-])Ї/gu, '$1Йи')
    .replace(/(^|[\s-])Є/gu, '$1Йе')
    .replace(/ї/gu, 'и')
    .replace(/є/gu, 'е')
    .replace(/ь([оО])/gu, 'ь$1')
    .replace(/ь([яюЯЮ])/gu, '$1')
    .replace(/ь(?![оО])/gu, '')
    .replace(/і/gu, 'и')
    .replace(/І/gu, 'И')
    .replace(/ґ/gu, 'г')
    .replace(/Ґ/gu, 'Г');
}

const RO: [RegExp, string][] = [
  [/chia/giu, 'кия'],
  [/ști\b/giu, 'щ'],
  [/şti\b/giu, 'щ'],
  [/ce(?=[aăou])/giu, 'ч'],
  [/ci(?=[aăou])/giu, 'ч'],
  [/ce/giu, 'че'],
  [/ci/giu, 'чи'],
  [/che/giu, 'ке'],
  [/chi/giu, 'ки'],
  [/ge(?=[aăou])/giu, 'дж'],
  [/gi(?=[aăou])/giu, 'дж'],
  [/ge/giu, 'дже'],
  [/gi/giu, 'джи'],
  [/ghe/giu, 'ге'],
  [/ghi/giu, 'ги'],
  [/ia/giu, 'ия'],
  [/ea/giu, 'я'],
  [/[șş]/giu, 'ш'],
  [/[țţ]/giu, 'ц'],
  [/[ăâî]/giu, 'ъ'],
];
const LATIN: Record<string, string> = { a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', x: 'кс', y: 'и', z: 'з', w: 'в', q: 'к' };

/** Romanian (Moldova) → Bulgarian. */
export function fromRomanian(name: string): string {
  let s = name;
  for (const [re, bg] of RO) s = s.replace(re, (m) => (m[0] === m[0]!.toUpperCase() && m[0] !== m[0]!.toLowerCase() ? bg[0]!.toUpperCase() + bg.slice(1) : bg));
  return [...s].map((ch) => {
    const lower = ch.toLowerCase();
    const bg = LATIN[lower];
    if (!bg) return ch;
    return ch === lower ? bg : bg[0]!.toUpperCase() + bg.slice(1);
  }).join('');
}

/** Whether a name is written in Cyrillic (and so can be shown to a Bulgarian reader). */
export const isCyrillic = (s: string) => /^[\p{Script=Cyrillic}\s\-.,()0-9]+$/u.test(s);
