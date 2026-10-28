import { inSeasonWindow, sofiaMonthDay } from './seasonal';

/**
 * 1.1.4: Ден на народните будители (1 ноември) — a small holiday of two days:
 * some pallet loads are books and school things (better pay), and three of
 * them bring a badge and ТрансКоин. Dates: 1–2 November (Sofia). Game data.
 */
export const BUDITELI = {
  from: '11-01',
  to: '11-02',
  contractShare: 0.25,
  rewardMultiplier: 1.2,
  goods: {
    pallets: ['Книги и учебници', 'Училищни пособия', 'Книги за читалища', 'Енциклопедии и речници', 'Тетрадки и учебни помагала'],
  } as Record<string, string[]>,
  /** Deliveries of these loads for the badge (once a year). */
  forBadge: 3,
  coins: 15,
} as const;

export function isBuditeli(now: Date): boolean {
  return inSeasonWindow(sofiaMonthDay(now), BUDITELI);
}

/** The badge of the year (one per year, kept in BADGES). */
export const buditeliBadge = (year: number) => `buditeli-${year}`;
