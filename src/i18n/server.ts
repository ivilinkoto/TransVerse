import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { MESSAGES, setFallbackLocale, withLocale } from './als';
import { DEFAULT_LOCALE, isLocale, pickLocale, type Locale } from './config';

/**
 * The language while rendering: a page, layout or generateMetadata calls
 * `await initLocale()` once at its start; everything it renders afterwards
 * reads the request's language. Actions and API routes use `withLocale`.
 */
export { MESSAGES, withLocale };

const holder = cache(() => ({ locale: null as Locale | null }));

function requestHolder() {
  try {
    return holder();
  } catch {
    return null;
  }
}

setFallbackLocale(() => requestHolder()?.locale ?? null);

/** The language of this request: the cookie, else the browser's languages. */
export async function requestLocale(): Promise<Locale> {
  try {
    const fromCookie = (await cookies()).get('tv_locale')?.value;
    if (isLocale(fromCookie)) return fromCookie;
    return pickLocale((await headers()).get('accept-language'));
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Call once at the start of a page, layout or generateMetadata. */
export async function initLocale(): Promise<Locale> {
  const h = requestHolder();
  if (h?.locale) return h.locale;
  const locale = await requestLocale();
  if (h) h.locale = locale;
  return locale;
}

/** The language of an incoming request (API routes). */
export function localeOfRequest(request: Request): Locale {
  const cookie = /(?:^|;\s*)tv_locale=([a-z]{2})/.exec(request.headers.get('cookie') ?? '')?.[1];
  return isLocale(cookie) ? cookie : pickLocale(request.headers.get('accept-language'));
}
