import { kmByCountry } from './fuel';

/**
 * The roads of "Цяла Европа" (v1.7), game data modelled on the real rules:
 * - Tolls by country: a per-km charge for heavy trucks (Germany, Austria,
 *   Switzerland, Poland, Hungary…) at its own level, motorway tolls (France,
 *   Italy, Spain, Portugal…), and vignettes (Romania, the Netherlands,
 *   Luxembourg) paid once per trip through the country. Vans pay no truck toll.
 * - Low-emission zones in big cities: a diesel truck pays a fee to load or
 *   unload there, an electric one does not.
 */

/** Per-km factor on the game's base toll (1 = the old single rate). */
export const TOLL_FACTOR: Record<string, number> = {
  DE: 1.6, AT: 2, CH: 2.6, FR: 1.4, IT: 1.3, ES: 0.9, PT: 1.2, PL: 0.8, CZ: 1.1, SK: 1, HU: 1.2, SI: 1.3, HR: 1,
  BE: 1.1, BG: 0.9, GR: 0.9, TR: 0.7, RS: 0.8, MK: 0.6, AL: 0.4, BA: 0.6, ME: 0.5, XK: 0.3,
  // v2.0: per-km systems in Belarus (BelToll) and Russia (Platon); no truck toll in Ukraine, Georgia and Armenia.
  BY: 0.8, RU: 0.45, UA: 0, GE: 0, AM: 0,
};

/** Countries with a vignette instead of a per-km toll: cents once per trip through them. */
export const TOLL_VIGNETTE_CENTS: Record<string, number> = { RO: 25_00, NL: 20_00, LU: 15_00, LT: 14_00, LV: 12_00, EE: 10_00, MD: 8_00 };

/** Truck toll of a leg by the kilometres in each country (cents). */
export function countryTollCents(startCountry: string, km: number, borders: readonly { km: number; to: string }[], baseCentsPerKm: number) {
  if (km <= 0) return 0;
  let cents = 0;
  for (const [country, k] of Object.entries(kmByCountry(startCountry, km, borders))) {
    if (k <= 0) continue;
    cents += TOLL_VIGNETTE_CENTS[country] ?? k * baseCentsPerKm * (TOLL_FACTOR[country] ?? 1);
  }
  return Math.round(cents);
}

type Seg = { kind: string; leg: string; start: number; end: number; fromKm: number; toKm: number; note?: string };

/** The note a weekend-ban wait carried (1.7 – 1.10). */
const BAN_NOTE = /^(Забрана за движение|Driving ban|Запрет на движение) \(/;

/**
 * Weekend driving bans were taken out of the game (October 2026): on game-time
 * trips they held a truck for up to a day. A trip under way still carries
 * its wait — this drops what is left of it and moves the rest of the trip
 * earlier by as much. Returns the schedule unchanged when there is no wait.
 */
export function withoutBanWaits<T extends Seg>(segments: readonly T[], now: number): { segments: T[]; savedMs: number } {
  let shift = 0;
  const out: T[] = [];
  for (const s of segments) {
    if (s.kind === 'incident' && s.note && BAN_NOTE.test(s.note) && s.end > now) {
      const from = Math.max(s.start - shift, now);
      const cut = s.end - shift - from;
      // The part already waited stays in the log.
      if (from > s.start - shift) out.push({ ...s, start: s.start - shift, end: from });
      shift += cut;
      continue;
    }
    out.push(shift ? { ...s, start: s.start - shift, end: s.end - shift } : s);
  }
  return { segments: out, savedMs: shift };
}

/** Low-emission zones (real cities, GeoNames ids): a fee for a diesel truck loading or unloading there. */
export const LOW_EMISSION_ZONES: Record<number, string> = {
  2988507: 'Париж', 2996944: 'Лион', 3173435: 'Милано', 3169070: 'Рим', 3117735: 'Мадрид', 3128760: 'Барселона', 2800866: 'Брюксел', 2759794: 'Амстердам',
};
export const LEZ = { feeCents: 35_00, vanShare: 0.5 } as const;

/** The zone fee of a trip through the given cities (origin, drops, destination). */
export function lezFeeCents(cityIds: readonly number[], vehicle: { electric: boolean; van: boolean }) {
  if (vehicle.electric) return 0;
  const zones = new Set(cityIds.filter((id) => id in LOW_EMISSION_ZONES)).size;
  return Math.round(zones * LEZ.feeCents * (vehicle.van ? LEZ.vanShare : 1));
}
