import { inSeasonWindow, sofiaMonthDay } from './seasonal';

/**
 * Първа пролет (v1.6), game data:
 * - The equinox (20–23 March): day and night are equal — every delivery on
 *   time pays a little more, and ten of them earn a badge. A spring paint
 *   "Цъфнала череша" is sold until mid-April.
 * - The passes open: after the winter (16 March – 15 April) the first ten
 *   players through each mountain country get a prize and a place in the
 *   passes' chronicle.
 * - Sowing (1 March – 31 May): seeds, fertilisers and farm machinery.
 * - National days of the countries in the game: loads to that country pay
 *   more on its day.
 */
export const SPRING = {
  year: 2027,
  /** The spring tab and the paint (MM-DD, Sofia). */
  from: '03-16',
  to: '04-15',
  equinox: { from: '03-20', to: '03-23' },
  equinoxShare: 0.08,
  equinoxBadge: 'spring-2027',
  equinoxBadgeTrips: 10,
  paintColor: '#f9a8d4',
} as const;

export const isSpring = (now: Date) => inSeasonWindow(sofiaMonthDay(now), SPRING);
export const isEquinox = (now: Date) => inSeasonWindow(sofiaMonthDay(now), SPRING.equinox);

export const PASS_OPENING = {
  from: '03-16',
  to: '04-15',
  /** Countries with mountain passes closed by blizzards in the winter. */
  countries: ['AT', 'RS', 'MK', 'BG', 'RO'] as readonly string[],
  firstN: 10,
  prizeCents: 1_000_00,
} as const;

export const isPassOpening = (now: Date) => inSeasonWindow(sofiaMonthDay(now), PASS_OPENING);

export const SOWING = {
  from: '03-01',
  to: '05-31',
  contractShare: 0.15,
  rewardMultiplier: 1.15,
  goods: {
    pallets: ['Семена за сеитба', 'Торове в чували', 'Препарати за растителна защита'],
    bulk: ['Семенно зърно', 'Минерален тор (насипно)'],
    special: ['Трактор', 'Сеялка', 'Пръскачка'],
  } as Record<string, string[]>,
} as const;

export const isSowing = (now: Date) => inSeasonWindow(sofiaMonthDay(now), SOWING);

/** National days of the countries in the game (MM-DD; real dates). */
export const NATIONAL_DAYS: Record<string, { day: string; label: string }> = {
  BG: { day: '03-03', label: 'Освобождението на България' },
  GR: { day: '03-25', label: 'Ден на независимостта на Гърция' },
  HU: { day: '03-15', label: 'Национален празник на Унгария' },
  RS: { day: '02-15', label: 'Ден на държавността на Сърбия' },
  RO: { day: '12-01', label: 'Национален ден на Румъния' },
  MK: { day: '09-08', label: 'Ден на независимостта на Северна Македония' },
  TR: { day: '10-29', label: 'Ден на републиката на Турция' },
  AT: { day: '10-26', label: 'Национален празник на Австрия' },
  DE: { day: '10-03', label: 'Ден на германското единство' },
  // v1.7: Цяла Европа (real dates).
  PL: { day: '11-11', label: 'Ден на независимостта на Полша' },
  CZ: { day: '10-28', label: 'Ден на независимата чехословашка държава' },
  SK: { day: '09-01', label: 'Ден на конституцията на Словакия' },
  SI: { day: '06-25', label: 'Ден на държавността на Словения' },
  HR: { day: '05-30', label: 'Ден на държавността на Хърватия' },
  BA: { day: '03-01', label: 'Ден на независимостта на Босна и Херцеговина' },
  ME: { day: '07-13', label: 'Ден на държавността на Черна гора' },
  AL: { day: '11-28', label: 'Ден на независимостта на Албания' },
  XK: { day: '02-17', label: 'Ден на независимостта на Косово' },
  IT: { day: '06-02', label: 'Празник на Републиката в Италия' },
  FR: { day: '07-14', label: 'Национален празник на Франция' },
  ES: { day: '10-12', label: 'Национален празник на Испания' },
  PT: { day: '06-10', label: 'Ден на Португалия' },
  NL: { day: '04-27', label: 'Ден на краля в Нидерландия' },
  BE: { day: '07-21', label: 'Национален празник на Белгия' },
  LU: { day: '06-23', label: 'Национален празник на Люксембург' },
  CH: { day: '08-01', label: 'Национален празник на Швейцария' },
  // v2.0 (real dates).
  MD: { day: '08-27', label: 'Ден на независимостта на Молдова' },
  UA: { day: '08-24', label: 'Ден на независимостта на Украйна' },
  BY: { day: '07-03', label: 'Ден на независимостта на Беларус' },
  LT: { day: '02-16', label: 'Ден на възстановяването на литовската държава' },
  LV: { day: '11-18', label: 'Ден на провъзгласяването на Латвийската република' },
  EE: { day: '02-24', label: 'Ден на независимостта на Естония' },
  RU: { day: '06-12', label: 'Ден на Русия' },
  GE: { day: '05-26', label: 'Ден на независимостта на Грузия' },
  AM: { day: '09-21', label: 'Ден на независимостта на Армения' },
};

export const NATIONAL_DAY = { rewardMultiplier: 1.1 } as const;

/** The country whose national day it is today (Sofia date), if any. */
export function nationalDayToday(now: Date, country: string) {
  const d = NATIONAL_DAYS[country];
  return d && d.day === sofiaMonthDay(now) ? d : null;
}

/** The next national days from today (for the calendar). */
export function upcomingNationalDays(now: Date, n = 4) {
  const md = sofiaMonthDay(now);
  const all = Object.entries(NATIONAL_DAYS).map(([country, d]) => ({ country, ...d }));
  return [...all.filter((d) => d.day >= md).sort((a, b) => a.day.localeCompare(b.day)), ...all.filter((d) => d.day < md).sort((a, b) => a.day.localeCompare(b.day))].slice(0, n);
}
