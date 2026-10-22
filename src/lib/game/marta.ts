import type { HalloweenQuest } from './halloween';
import { sofiaMidnight } from './missions';
import { inSeasonWindow, sofiaMonthDay } from './seasonal';

/**
 * Баба Марта (v1.5): spring loads, martenitsas on the trucks and the base,
 * a martenitsa for a friend and a stork somewhere on the map every day.
 * Content follows the dates (1–31 March, Sofia). Game data.
 */
export const MARTA = {
  year: 2027,
  key: 'marta-2027',
  from: '03-01',
  to: '03-31',
  contractShare: 0.2,
  rewardMultiplier: 1.25,
  goods: {
    pallets: ['Мартенички', 'Цветя и разсад', 'Пролетни семена', 'Саксии и градинска пръст'],
    refrigerated: ['Рязани цветя — лалета и нарциси', 'Пролетни зеленчуци', 'Прясна зеленчукова разсада'],
  } as Record<string, string[]>,
  eventTemplate: 'marta-2027',
  eventStart: { month: 3, day: 1, hour: 10 },
  eventEnd: { month: 3, day: 8, hour: 18 },
  badge: 'marta-2027',
  /** ТрансКоин for spotting the stork of the day (once a day). */
  storkCoins: 5,
  /** Spring cleaning: repairs and maintenance cost less in March. */
  springDiscount: 0.25,
} as const;

export function isMarta(now: Date): boolean {
  return inSeasonWindow(sofiaMonthDay(now), MARTA);
}

const at = (p: { month: number; day: number; hour: number }) => new Date(sofiaMidnight(MARTA.year, p.month, p.day).getTime() + p.hour * 3_600_000);

export function martaEventWindow() {
  return { startsAt: at(MARTA.eventStart), endsAt: at(MARTA.eventEnd) };
}

/** Spring cleaning (March): the share off repairs and maintenance. */
export const springDiscount = (now: Date) => (isMarta(now) ? MARTA.springDiscount : 0);

export const MARTA_QUESTS: HalloweenQuest[] = [
  { id: 'm_loads', title: 'Достави 5 пролетни товара', target: 5, coins: 30, cents: 1_000_00 },
  { id: 'm_km', title: 'Измини 1 500 км с пролетни товари', target: 1_500, coins: 40, cents: 2_000_00 },
  { id: 'm_gift', title: 'Подари мартеничка на приятел', target: 1, coins: 15, cents: 0 },
  { id: 'm_stork', title: 'Забележи щъркела на картата', target: 1, coins: 15, cents: 0 },
];

export function martaIncrements(f: { holiday: boolean; loadedKm: number }): Record<string, number> {
  return { m_loads: f.holiday ? 1 : 0, m_km: f.holiday ? Math.round(f.loadedKm) : 0, m_gift: 0, m_stork: 0 };
}
