import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from './config';

/**
 * Translation (v2.0). The Bulgarian text is its own key: `t('Камионът е на
 * курс.')` gives the text in the player's language, `t('Нужна е репутация
 * {0}', n)` fills the places. Unknown text comes back as it is (Bulgarian).
 * Values that are themselves known text (goods, cities, labels) are
 * translated too.
 *
 * The language comes from a resolver set by the environment: the server
 * (request, action or worker; src/i18n/server.ts) or the browser
 * (src/i18n/client.tsx). Without one — tests, scripts — it is Bulgarian.
 */
export type Messages = Readonly<Record<string, string>>;
type Resolver = () => { locale: Locale; messages: Messages | null };

let resolver: Resolver = () => ({ locale: DEFAULT_LOCALE, messages: null });
export function setResolver(r: Resolver) {
  resolver = r;
}

export function format(messages: Messages | null, key: string, values: readonly unknown[]): string {
  const text = messages?.[key] ?? key;
  if (!values.length) return text;
  return text.replace(/\{(\d+)\}/g, (m, i: string) => {
    const v = values[Number(i)];
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return messages?.[v] ?? v;
    return String(v);
  });
}

export function t(key: string, ...values: unknown[]): string {
  const { messages } = resolver();
  return format(messages, key, values);
}

/** A value shown as it is unless it is known text (a label, goods, a city): then it is translated. */
export function tx<T>(value: T): T {
  if (typeof value !== 'string') return value;
  const { messages } = resolver();
  return ((messages && messages[value]) ?? value) as T;
}

export const currentLocale = (): Locale => resolver().locale;
export const intlLocale = () => INTL_LOCALE[currentLocale()];
