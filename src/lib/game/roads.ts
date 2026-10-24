import { sofiaHourOf } from './together';
import { t } from '@/i18n/t';

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
  // v1.7: Цяла Европа.
  PL: ['A2 Варшава – Познан', 'A4 Вроцлав – Краков'],
  CZ: ['D1 Прага – Бърно'],
  SK: ['D1 Братислава – Жилина'],
  SI: ['A1 Любляна – Марибор'],
  HR: ['A1 Загреб – Сплит'],
  BA: ['A1 Сараево – Зеница'],
  IT: ['A1 Милано – Неапол', 'A4 Торино – Венеция', 'A14 Болоня – Таранто'],
  FR: ['A6 Париж – Лион', 'A7 Лион – Марсилия', 'A1 Париж – Лил'],
  ES: ['AP-7 Барселона – Валенсия', 'A-4 Мадрид – Севиля'],
  PT: ['A1 Лисабон – Порто'],
  NL: ['A2 Амстердам – Утрехт', 'A15 Ротердам – Неймеген'],
  BE: ['E40 Брюксел – Гент', 'E19 Антверпен – Брюксел'],
  CH: ['A1 Цюрих – Берн', 'A2 Базел – Киасо'],
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

/**
 * Cargo insurance (v1.5): when taking a load the player may insure it for a
 * share of its pay; a late arrival's penalties are then mostly covered.
 */
export const CARGO_INSURANCE = { premiumShare: 0.03, covers: 0.8 } as const;

export const oversizeCostCents = (km: number) => OVERSIZE.permitCents + Math.round(km * OVERSIZE.escortCentsPerKm);

/**
 * Rush hour (v1.5): in big cities (by real population) loading and unloading
 * take longer between 7 and 9 and between 17 and 19, by the city's own clock.
 */
export const RUSH_HOUR = {
  hours: [[7, 9], [17, 19]] as [number, number][],
  minPopulation: 300_000,
  /** Extra share of the loading or unloading time. */
  extra: 0.5,
} as const;

export function isRushHour(at: number, timezone: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(at));
  return RUSH_HOUR.hours.some(([a, b]) => h >= a && h < b);
}

type Seg = { kind: string; leg: string; start: number; end: number; stop?: number; note?: string };

/** Lengthens the loading in the origin and the final unloading in the destination when they fall in a big city's rush hour; later segments move on. */
export function applyRushHour<T extends Seg>(segments: readonly T[], origin: { population: number; timezone: string }, dest: { population: number; timezone: string }): { segments: T[]; rush: ('loading' | 'unloading')[] } {
  let shift = 0;
  const rush: ('loading' | 'unloading')[] = [];
  const lastUnload = segments.findLastIndex((s) => s.kind === 'unloading' && s.leg === 'loaded' && !s.stop);
  const out = segments.map((s, i) => {
    const seg = { ...s, start: s.start + shift, end: s.end + shift };
    const city = s.kind === 'loading' && s.leg === 'loaded' ? origin : i === lastUnload ? dest : null;
    if (city && city.population >= RUSH_HOUR.minPopulation && isRushHour(seg.start, city.timezone)) {
      const extra = Math.round((seg.end - seg.start) * RUSH_HOUR.extra);
      seg.end += extra;
      shift += extra;
      seg.note = t('Час пик');
      rush.push(s.kind === 'loading' ? 'loading' : 'unloading');
    }
    return seg;
  });
  return { segments: out, rush };
}
