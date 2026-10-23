import { seededRandom } from './road-events';
import { sofiaMonthDay } from './seasonal';

/**
 * Winter on the roads (game data, inspired by real conditions): from December
 * to mid-March every country has a road condition for the day — clear, snow,
 * ice or a blizzard that closes the mountain passes. A trip through a country
 * with bad roads may meet a winter event on the way; winter tyres halve both
 * the chance and the delay. Some loads are winter goods that pay better.
 */
export const WINTER = {
  /** Season window, MM-DD inclusive (Sofia); it wraps over the new year. */
  from: '12-01',
  to: '03-15',
  /** Share of new bulk, liquid and pallet loads that are winter goods. */
  contractShare: 0.2,
  rewardMultiplier: 1.15,
  goods: {
    bulk: ['Сол за пътищата', 'Пясък за зимно поддържане'],
    liquid: ['Дизел за отопление', 'Мазут за котелни'],
    pallets: ['Пелети за отопление', 'Зимни гуми', 'Ски оборудване', 'Дърва за огрев'],
  } as Record<string, string[]>,
  /** Upgrade that halves winter chances and delays (rented trucks have them). */
  tyres: 'winter_tyres',
  tyresFactor: 0.5,
} as const;

/** How hard winter hits each country (mountain passes, latitude). */
export const WINTER_SEVERITY: Record<string, number> = {
  AT: 1, RS: 0.85, MK: 0.85, BG: 0.8, RO: 0.9, HU: 0.65, DE: 0.6, TR: 0.5, GR: 0.35,
  // v1.7: Цяла Европа.
  CH: 1, SI: 0.85, SK: 0.85, BA: 0.85, XK: 0.85, ME: 0.8, PL: 0.75, CZ: 0.7, IT: 0.55, FR: 0.55, HR: 0.5, AL: 0.55, LU: 0.5, BE: 0.4, NL: 0.4, ES: 0.3, PT: 0.2,
};
const MONTH_FACTOR: Record<number, number> = { 12: 0.8, 1: 1.1, 2: 1, 3: 0.5 };

export type RoadCondition = 'clear' | 'snow' | 'ice' | 'blizzard';
export const CONDITION_RANK: Record<RoadCondition, number> = { clear: 0, snow: 1, ice: 2, blizzard: 3 };
export const CONDITION_LABELS: Record<RoadCondition, string> = { clear: 'Чисти пътища', snow: 'Сняг', ice: 'Заледено', blizzard: 'Виелица · затворени проходи' };

export function isWinter(now: Date): boolean {
  const md = sofiaMonthDay(now);
  return md >= WINTER.from || md <= WINTER.to;
}

const sofiaDate = (t: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);

/** Road conditions from the real weather now (v1.4), by country; missing countries use the game's model. */
export type RealConditions = Partial<Record<string, RoadCondition>>;

/** The road condition of a country on a given day (the same for everyone that day). */
export function roadCondition(country: string, now: Date, real?: RealConditions | null): RoadCondition {
  const measured = real?.[country];
  if (measured) return measured;
  if (!isWinter(now)) return 'clear';
  const day = sofiaDate(now);
  const sev = (WINTER_SEVERITY[country] ?? 0.5) * (MONTH_FACTOR[Number(day.slice(5, 7))] ?? 0);
  const r = seededRandom(`winter:${country}:${day}`)();
  if (r < 0.06 * sev) return 'blizzard';
  if (r < 0.2 * sev) return 'ice';
  if (r < 0.5 * sev) return 'snow';
  return 'clear';
}

/** The worst condition along a route and where it is. */
export function routeCondition(countries: readonly string[], now: Date, real?: RealConditions | null): { condition: RoadCondition; country: string | null } {
  let worst: { condition: RoadCondition; country: string | null } = { condition: 'clear', country: null };
  for (const c of countries) {
    const condition = roadCondition(c, now, real);
    if (CONDITION_RANK[condition] > CONDITION_RANK[worst.condition]) worst = { condition, country: c };
  }
  return worst;
}

/** Chance that a trip meets a winter event, by the worst condition on the way. */
export const WINTER_EVENT_CHANCE: Record<Exclude<RoadCondition, 'clear'>, number> = { snow: 0.55, ice: 0.5, blizzard: 0.9 };

/**
 * The road condition from a weather reading (Open-Meteo, the hour now):
 * heavy snow with strong wind is a blizzard, any snowfall is snow, rain or
 * freezing drizzle at or below zero is ice.
 */
export function conditionFromWeather(w: { tempC: number; precipMm: number; snowCm: number; gustKmh: number; code: number }): RoadCondition {
  if (w.snowCm >= 1.5 && w.gustKmh >= 50) return 'blizzard';
  if (w.snowCm > 0.1 || [71, 73, 75, 77, 85, 86].includes(w.code)) return 'snow';
  if ([56, 57, 66, 67].includes(w.code) || (w.tempC <= 0.5 && w.precipMm > 0)) return 'ice';
  return 'clear';
}
