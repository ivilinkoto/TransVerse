import type { HalloweenQuest } from './halloween';
import { sofiaMidnight } from './missions';
import { inSeasonWindow, sofiaMonthDay } from './seasonal';

/**
 * Великден (v1.5): Orthodox Easter 2027 is on 2 May. Holiday loads
 * (kozunak, painted eggs, lamb), an egg fight between friends (no stake —
 * the game gives the winner ТрансКоин), a spring paint and quests. Game data.
 */
export const EASTER = {
  year: 2027,
  key: 'easter-2027',
  from: '04-25',
  to: '05-09',
  /** Easter Sunday 2027 (Orthodox). */
  sunday: '05-02',
  contractShare: 0.2,
  rewardMultiplier: 1.25,
  goods: {
    pallets: ['Козунаци', 'Боядисани яйца', 'Великденски кошници', 'Шоколадови яйца'],
    refrigerated: ['Пресни яйца', 'Агнешко за празника', 'Козунаци с крем'],
  } as Record<string, string[]>,
  eventTemplate: 'easter-2027',
  eventStart: { month: 4, day: 25, hour: 10 },
  eventEnd: { month: 5, day: 2, hour: 10 },
  badge: 'easter-2027',
  eggBadge: 'strong-egg',
  /** An egg fight: ТрансКоин for the winner; the badge at this many wins. */
  eggCoins: 3,
  eggBadgeWins: 5,
  paintPrice: 80,
  paintColor: '#a78bfa',
} as const;

export const isEaster = (now: Date) => inSeasonWindow(sofiaMonthDay(now), EASTER);

const at = (p: { month: number; day: number; hour: number }) => new Date(sofiaMidnight(EASTER.year, p.month, p.day).getTime() + p.hour * 3_600_000);
export const easterEventWindow = () => ({ startsAt: at(EASTER.eventStart), endsAt: at(EASTER.eventEnd) });

export const EASTER_QUESTS: HalloweenQuest[] = [
  { id: 'e_loads', title: 'Достави 5 великденски товара', target: 5, coins: 30, cents: 1_000_00 },
  { id: 'e_km', title: 'Измини 1 500 км с великденски товари', target: 1_500, coins: 40, cents: 2_000_00 },
  { id: 'e_egg', title: 'Спечели яйчена битка с приятел', target: 1, coins: 15, cents: 0 },
  { id: 'e_sunday', title: 'Пристигни с товар на Великден (2 май)', target: 1, coins: 20, cents: 0 },
];

export function easterIncrements(f: { holiday: boolean; loadedKm: number; arrivedAt: Date }): Record<string, number> {
  return { e_loads: f.holiday ? 1 : 0, e_km: f.holiday ? Math.round(f.loadedKm) : 0, e_egg: 0, e_sunday: sofiaMonthDay(f.arrivedAt) === EASTER.sunday ? 1 : 0 };
}
