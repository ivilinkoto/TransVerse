import type { HalloweenQuest } from './halloween';
import { sofiaMidnight } from './missions';
import { inSeasonWindow, sofiaMonthDay } from './seasonal';

/**
 * Christmas content (v1.2 "Коледна треска"): holiday loads, the community
 * event "presents in time for Christmas Eve", the Christmas quests, the
 * badge and the "Коледа" paint. Like Halloween, content follows the dates
 * only (not the admin's theme switch). Game data.
 */
export const CHRISTMAS = {
  year: 2026,
  key: 'christmas-2026',
  /** Content window, MM-DD inclusive (Sofia); it wraps over the new year. */
  from: '12-15',
  to: '01-06',
  contractShare: 0.22,
  rewardMultiplier: 1.3,
  goods: {
    pallets: ['Коледни подаръци', 'Играчки за Коледа', 'Коледни елхи', 'Лампички и украса за елха'],
    refrigerated: ['Козунаци и коледни сладки', 'Мандарини и портокали', 'Шоколадови подаръци', 'Празнични меса за трапезата'],
  } as Record<string, string[]>,
  /** The community event: presents must arrive by Christmas Eve. */
  eventTemplate: 'christmas-2026',
  eventStart: { month: 12, day: 15, hour: 18 },
  eventEnd: { month: 12, day: 24, hour: 18 },
  badge: 'santa-2026',
  paintPrice: 80,
  paintColor: '#b91c1c',
} as const;

export function isChristmas(now: Date): boolean {
  return inSeasonWindow(sofiaMonthDay(now), CHRISTMAS);
}

const at = (p: { month: number; day: number; hour: number }) => new Date(sofiaMidnight(CHRISTMAS.year, p.month, p.day).getTime() + p.hour * 3_600_000);

export function christmasEventWindow() {
  return { startsAt: at(CHRISTMAS.eventStart), endsAt: at(CHRISTMAS.eventEnd) };
}

/** The Christmas quests: the same for every player, once per year. All four earn the badge. */
export const CHRISTMAS_QUESTS: HalloweenQuest[] = [
  { id: 'c_loads', title: 'Достави 5 коледни товара', target: 5, coins: 30, cents: 1_000_00 },
  { id: 'c_km', title: 'Измини 1 500 км с коледни товари', target: 1_500, coins: 40, cents: 2_000_00 },
  { id: 'c_eve', title: 'Пристигни с товар на Бъдни вечер или Коледа (24–25 декември)', target: 1, coins: 20, cents: 0 },
  { id: 'c_help', title: 'Помогни на приятел или колега на пътя', target: 1, coins: 25, cents: 0 },
];

/** What a finished delivery adds to each Christmas quest. */
export function christmasIncrements(f: { holiday: boolean; loadedKm: number; arrivedAt: Date }): Record<string, number> {
  const md = sofiaMonthDay(f.arrivedAt);
  return {
    c_loads: f.holiday ? 1 : 0,
    c_km: f.holiday ? Math.round(f.loadedKm) : 0,
    c_eve: md === '12-24' || md === '12-25' ? 1 : 0,
    c_help: 0,
  };
}

