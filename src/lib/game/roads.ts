import { sofiaHourOf } from './together';

/**
 * Night shift (v1.5): a trip that starts between 22:00 and 05:00 (Sofia)
 * goes on emptier roads — it is faster, the driver tires more, and an on-time
 * night delivery earns a bonus. Game data.
 */
export const NIGHT = {
  fromHour: 22,
  toHour: 5,
  /** Game time ×. */
  faster: 1.1,
  /** Driving hours count this much more towards the daily rest. */
  fatigue: 1.15,
  bonusShare: 0.05,
} as const;

export const isNightShift = (now: Date) => {
  const h = sofiaHourOf(now);
  return h >= NIGHT.fromHour || h < NIGHT.toHour;
};

/**
 * Road works (v1.5): real motorways get works for a few days; a trip through
 * that country is slower. Which trips pass the works is decided by the
 * country of the route (the works are game data on real roads).
 */
export const ROAD_WORKS = {
  /** How many at a time and how long each lasts. */
  max: 3,
  days: [2, 5] as const,
  /** Extra time of a trip through the country of the works. */
  delay: [0.06, 0.15] as const,
  /** A new one starts at most this often. */
  everyHours: 18,
} as const;

/** Real motorways by country (names as on the road signs). */
export const MOTORWAYS: Record<string, string[]> = {
  BG: ['АМ „Тракия“ (A1)', 'АМ „Хемус“ (A2)', 'АМ „Марица“ (A4)', 'АМ „Струма“ (A6)'],
  RO: ['A1 Букурещ – Питещ', 'A2 Букурещ – Констанца'],
  GR: ['A1 Атина – Солун', 'A2 „Егнатия Одос“'],
  RS: ['A1 Белград – Ниш'],
  TR: ['O-3 Одрин – Истанбул'],
  HU: ['M1 Будапеща – Дьор', 'M5 Будапеща – Сегед'],
  AT: ['A1 Westautobahn', 'A2 Südautobahn'],
  DE: ['A3 Франкфурт – Нюрнберг', 'A7 Хамбург – Касел', 'A9 Мюнхен – Нюрнберг'],
  MK: ['A1 Куманово – Гевгелия'],
};

/** Extra-time factor of a route through the countries with works now (the worst counts). */
export function roadWorksFactor(countries: readonly string[], works: readonly { countryCode: string; delay: number }[]): number {
  const hit = works.filter((w) => countries.includes(w.countryCode));
  return 1 + Math.max(0, ...hit.map((w) => w.delay));
}

/**
 * Oversize loads (v1.5): wind turbine blades, transformers, bridge girders.
 * Only on a low-bed trailer behind a heavy-haul tractor; slower (escort),
 * a permit and an escort car are paid at the end, and the pay is high.
 */
export const OVERSIZE = {
  open: 6,
  goods: ['Лопатка за вятърна турбина', 'Силов трансформатор', 'Мостова греда', 'Корпус на кран', 'Минен багер'],
  tons: [28, 40] as const,
  minKm: 250,
  maxKm: 1_200,
  multiplier: 2.2,
  /** Game time × (slower: the escort and the speed limits). */
  slower: 0.8,
  permitCents: 1_200_00,
  escortCentsPerKm: 90,
  hours: 36,
} as const;

export const oversizeCostCents = (km: number) => OVERSIZE.permitCents + Math.round(km * OVERSIZE.escortCentsPerKm);
