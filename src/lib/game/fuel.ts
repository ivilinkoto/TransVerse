import { ECONOMY } from './economy';
import { seededRandom } from './road-events';

/**
 * Diesel prices by country — game data, roughly at the level of real pump
 * prices so that routes through cheap and expensive countries differ. They move
 * a little every day (deterministic, the same for every player).
 */
export const DIESEL_CENTS_PER_LITRE: Record<string, number> = {
  BG: 142, RO: 150, GR: 172, TR: 132, RS: 166, MK: 138, AL: 176, ME: 150, BA: 146, XK: 145,
  HU: 160, HR: 152, SI: 148, AT: 158, DE: 168, CZ: 154, SK: 156, PL: 152, CH: 190, LI: 188,
  IT: 178, SM: 170, FR: 174, MC: 180, ES: 148, AD: 132, PT: 164, NL: 182, BE: 178, LU: 138,
  DK: 176, SE: 186, NO: 198, FI: 182, EE: 160, LV: 154, LT: 150, IE: 168, GB: 176,
  UA: 134, MD: 138, BY: 112,
};

/** Daily movement around the base price: ±6 %. */
export const FUEL_DAILY_SWING = 0.06;

const sofiaDay = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now);

/** Today's diesel price in a country (euro cents per litre). */
export function fuelPriceCents(country: string, now: Date): number {
  const base = DIESEL_CENTS_PER_LITRE[country] ?? ECONOMY.fuelPriceCentsPerLitre;
  const swing = (seededRandom(`${country}:${sofiaDay(now)}`)() * 2 - 1) * FUEL_DAILY_SWING;
  return Math.round(base * (1 + swing));
}

/** Kilometres driven in each country along a leg, from its border crossings. */
export function kmByCountry(startCountry: string, km: number, borders: readonly { km: number; to: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  let country = startCountry;
  let at = 0;
  for (const b of [...borders].sort((a, c) => a.km - c.km)) {
    const until = Math.min(km, Math.max(at, b.km));
    out[country] = (out[country] ?? 0) + (until - at);
    at = until;
    country = b.to;
  }
  out[country] = (out[country] ?? 0) + Math.max(0, km - at);
  return out;
}

/** Average price over a leg, weighted by the kilometres driven in each country. */
export function legFuelPriceCents(startCountry: string, km: number, borders: readonly { km: number; to: string }[], now: Date): number {
  if (km <= 0) return fuelPriceCents(startCountry, now);
  const split = kmByCountry(startCountry, km, borders);
  const total = Object.values(split).reduce((a, b) => a + b, 0) || 1;
  return Math.round(Object.entries(split).reduce((s, [c, k]) => s + fuelPriceCents(c, now) * k, 0) / total);
}
