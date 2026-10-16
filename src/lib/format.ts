/** Formatting helpers (Bulgarian locale). Money values are euro cents. */
const eur = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const eurPrecise = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('bg-BG', { maximumFractionDigits: 0 });
const num1 = new Intl.NumberFormat('bg-BG', { maximumFractionDigits: 1 });

export const money = (cents: number) => eur.format(cents / 100);
export const moneyPrecise = (cents: number) => eurPrecise.format(cents / 100);
export const int = (n: number) => num.format(n);
export const dec = (n: number) => num1.format(n);
export const km = (n: number) => `${num.format(Math.round(n))} км`;

export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d) return `${d} д ${h} ч`;
  if (h) return `${h} ч ${mm.toString().padStart(2, '0')} мин`;
  return `${mm} мин`;
}

const dt = new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Sofia' });
export const dateTime = (d: Date | string | number) => dt.format(new Date(d));
const dOnly = new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Sofia' });
export const date = (d: Date | string | number) => dOnly.format(new Date(d));
