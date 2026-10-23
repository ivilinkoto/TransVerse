import { kmByCountry } from './fuel';

/**
 * The roads of "Цяла Европа" (v1.7), game data modelled on the real rules:
 * - Tolls by country: a per-km charge for heavy trucks (Germany, Austria,
 *   Switzerland, Poland, Hungary…) at its own level, motorway tolls (France,
 *   Italy, Spain, Portugal…), and vignettes (Romania, the Netherlands,
 *   Luxembourg) paid once per trip through the country. Vans pay no truck toll.
 * - Weekend driving bans for heavy trucks (local time): the truck waits at
 *   the border (or at the start) until the ban ends. Public holidays are not
 *   modelled.
 * - Low-emission zones in big cities: a diesel truck pays a fee to load or
 *   unload there, an electric one does not.
 */

/** Per-km factor on the game's base toll (1 = the old single rate). */
export const TOLL_FACTOR: Record<string, number> = {
  DE: 1.6, AT: 2, CH: 2.6, FR: 1.4, IT: 1.3, ES: 0.9, PT: 1.2, PL: 0.8, CZ: 1.1, SK: 1, HU: 1.2, SI: 1.3, HR: 1,
  BE: 1.1, BG: 0.9, GR: 0.9, TR: 0.7, RS: 0.8, MK: 0.6, AL: 0.4, BA: 0.6, ME: 0.5, XK: 0.3,
};

/** Countries with a vignette instead of a per-km toll: cents once per trip through them. */
export const TOLL_VIGNETTE_CENTS: Record<string, number> = { RO: 25_00, NL: 20_00, LU: 15_00 };

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

/** Weekend bans in local time: [weekday 0 = Sunday, from hour, to hour). */
export const DRIVING_BANS: Record<string, { tz: string; label: string; windows: [number, number, number][] }> = {
  DE: { tz: 'Europe/Berlin', label: 'неделя до 22:00', windows: [[0, 0, 22]] },
  AT: { tz: 'Europe/Vienna', label: 'събота от 15:00 до неделя 22:00', windows: [[6, 15, 24], [0, 0, 22]] },
  FR: { tz: 'Europe/Paris', label: 'събота от 22:00 до неделя 22:00', windows: [[6, 22, 24], [0, 0, 22]] },
  IT: { tz: 'Europe/Rome', label: 'неделя 9:00 – 22:00', windows: [[0, 9, 22]] },
  CH: { tz: 'Europe/Zurich', label: 'цялата неделя и всяка нощ 22:00 – 5:00', windows: [[0, 0, 24], ...[0, 1, 2, 3, 4, 5, 6].flatMap((d) => [[d, 22, 24], [d, 0, 5]] as [number, number, number][])] },
  HU: { tz: 'Europe/Budapest', label: 'събота от 22:00 до неделя 22:00', windows: [[6, 22, 24], [0, 0, 22]] },
  SK: { tz: 'Europe/Bratislava', label: 'неделя до 22:00', windows: [[0, 0, 22]] },
  CZ: { tz: 'Europe/Prague', label: 'неделя 13:00 – 22:00', windows: [[0, 13, 22]] },
};

const localClock = (t: number, tz: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')!.value);
  return { wd, minutes: Number(parts.find((p) => p.type === 'hour')!.value) * 60 + Number(parts.find((p) => p.type === 'minute')!.value) };
};

/** When the ban in a country that covers `t` ends (epoch ms), or null. Back-to-back windows count as one. */
export function banEndsAt(country: string, t: number): number | null {
  const ban = DRIVING_BANS[country];
  if (!ban) return null;
  let at = t;
  for (let guard = 0; guard < 8; guard++) {
    const { wd, minutes } = localClock(at, ban.tz);
    const w = ban.windows.find(([d, from, to]) => d === wd && minutes >= from * 60 && minutes < to * 60);
    if (!w) return at === t ? null : at;
    at += (w[2] * 60 - minutes) * 60_000;
  }
  return at;
}

type Seg = { kind: string; leg: string; start: number; end: number; fromKm: number; toKm: number; note?: string };

/**
 * The truck waits for the end of a ban where it enters a country (at the
 * border) or where it sets off; later segments move on.
 */
export function applyDrivingBans<T extends Seg>(segments: readonly T[], legs: { empty?: { start: string; borders: readonly { km: number; to: string }[] } | null; loaded: { start: string; borders: readonly { km: number; to: string }[] } }): { segments: T[]; waits: { country: string; minutes: number }[] } {
  let shift = 0;
  const out: T[] = [];
  const waits: { country: string; minutes: number }[] = [];
  let lastLeg = '';
  for (const s of segments) {
    const seg = { ...s, start: s.start + shift, end: s.end + shift };
    const leg = seg.leg === 'empty' ? legs.empty : legs.loaded;
    // Setting off on a leg, or crossing into the next country.
    let country: string | null = null;
    if (leg && seg.kind === 'drive' && seg.leg !== lastLeg) country = leg.start;
    if (leg && out.length && out[out.length - 1]!.kind === 'border' && seg.kind !== 'border') {
      const b = [...leg.borders].sort((x, y) => Math.abs(x.km - seg.fromKm) - Math.abs(y.km - seg.fromKm))[0];
      if (b) country = b.to;
    }
    if (seg.kind === 'drive') lastLeg = seg.leg;
    const until = country ? banEndsAt(country, seg.start) : null;
    if (until && until > seg.start) {
      const wait = until - seg.start;
      out.push({ ...seg, kind: 'incident', end: seg.start, start: seg.start, toKm: seg.fromKm, note: `Забрана за движение (${country}) до ${new Intl.DateTimeFormat('bg-BG', { timeZone: DRIVING_BANS[country!]!.tz, hour: '2-digit', minute: '2-digit' }).format(until)}` } as T);
      out[out.length - 1]!.end = until;
      waits.push({ country: country!, minutes: Math.round(wait / 60_000) });
      seg.start += wait;
      seg.end += wait;
      shift += wait;
    }
    out.push(seg);
  }
  return { segments: out, waits };
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
