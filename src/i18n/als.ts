import { AsyncLocalStorage } from 'node:async_hooks';
import en from '../../messages/en.json';
import ru from '../../messages/ru.json';
import { DEFAULT_LOCALE, isLocale, type Locale } from './config';
import { setResolver, type Messages } from './t';

/**
 * The language of server code that is not rendering a page: actions, API
 * routes, worker jobs and the text a player receives (notifications, e-mail,
 * push) — that runs in the recipient's language with `withLocale`.
 */
export const MESSAGES: Record<Locale, Messages | null> = { bg: null, en: en as Messages, ru: ru as Messages };

const store = new AsyncLocalStorage<Locale>();
export const withLocale = <T,>(locale: Locale, fn: () => T): T => store.run(locale, fn);
export const localeNow = () => store.getStore();

/** Rendering pages adds the request's language (src/i18n/server.ts). */
let fallback: () => Locale | null = () => null;
export function setFallbackLocale(fn: () => Locale | null) {
  fallback = fn;
}

setResolver(() => {
  const locale = store.getStore() ?? fallback() ?? DEFAULT_LOCALE;
  return { locale, messages: MESSAGES[locale] };
});

/** Text built later, in the language of whoever reads it. */
export type LocalText = string | (() => string);
export const resolveText = (text: LocalText, locale: string | null | undefined) => (typeof text === 'function' ? withLocale(isLocale(locale) ? locale : DEFAULT_LOCALE, text) : text);
