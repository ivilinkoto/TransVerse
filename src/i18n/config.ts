/** The languages of the game (v2.0). Bulgarian is the source language: its text is the key. */
export const LOCALES = ['bg', 'en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'bg';
export const LOCALE_COOKIE = 'tv_locale';

export const INTL_LOCALE: Record<Locale, string> = { bg: 'bg-BG', en: 'en-GB', ru: 'ru-RU' };
export const LOCALE_LABELS: Record<Locale, string> = { bg: 'Български', en: 'English', ru: 'Русский' };
export const LOCALE_FLAGS: Record<Locale, string> = { bg: 'BG', en: 'EN', ru: 'RU' };
/** Open Graph locale tags. */
export const OG_LOCALE: Record<Locale, string> = { bg: 'bg_BG', en: 'en_GB', ru: 'ru_RU' };

export const isLocale = (x: unknown): x is Locale => typeof x === 'string' && (LOCALES as readonly string[]).includes(x);

/** The first supported language of an Accept-Language header (Bulgarian when none). */
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const wanted = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { tag: (tag ?? '').toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const w of wanted) {
    const base = w.tag.split('-')[0];
    if (isLocale(base)) return base;
    // Ukrainian and Belarusian readers get Russian rather than Bulgarian.
    if (base === 'uk' || base === 'be' || base === 'kk') return 'ru';
  }
  return wanted.length && wanted[0]!.tag !== '*' ? 'en' : DEFAULT_LOCALE;
}
