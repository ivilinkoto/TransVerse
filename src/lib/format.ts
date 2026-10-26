import { currentLocale, t } from '@/i18n/t';
import { INTL_LOCALE, type Locale } from '@/i18n/config';

/**
 * Formatting helpers, in the player's language (v2.0; Bulgarian by default).
 * Game money is in stotinki (1/100 of a lev) and shown in лв.; real-money
 * prices (ТрансКоин, VIP) are in euro and use `euro()` from lib/game/payments.
 */
export const CURRENCY = 'лв.';

const cacheOf = <T,>(make: (tag: string) => T) => {
  const m = new Map<Locale, T>();
  return () => {
    const l = currentLocale();
    let v = m.get(l);
    if (!v) m.set(l, (v = make(INTL_LOCALE[l])));
    return v;
  };
};
const num = cacheOf((tag) => new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }));
const num2 = cacheOf((tag) => new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const num1 = cacheOf((tag) => new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }));
const dt = cacheOf((tag) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Sofia' }));
const dOnly = cacheOf((tag) => new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Sofia' }));

export const money = (cents: number) => `${num().format(Math.round(cents / 100))} ${t(CURRENCY)}`;
export const moneyPrecise = (cents: number) => `${num2().format(cents / 100)} ${t(CURRENCY)}`;
export const int = (n: number) => num().format(n);
export const dec = (n: number) => num1().format(n);
export const km = (n: number) => `${num().format(Math.round(n))} ${t('км')}`;

export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d) return t('{0} д {1} ч', d, h);
  if (h) return t('{0} ч {1} мин', h, mm.toString().padStart(2, '0'));
  return t('{0} мин', mm);
}

export const dateTime = (d: Date | string | number) => dt().format(new Date(d));
export const date = (d: Date | string | number) => dOnly().format(new Date(d));
/** The Intl tag of the player's language (for local formatting elsewhere). */
export const intlTag = () => INTL_LOCALE[currentLocale()];
