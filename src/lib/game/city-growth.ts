import { inSeasonWindow, sofiaMonthDay } from './seasonal';

/**
 * Градът расте (v1.10): every tonne delivered to a real city counts for the
 * whole server (game data). The city's level rises with it, and loads from
 * a bigger level pay a little more. Each week the cities race for the most
 * tonnes.
 */
export const CITY_LEVELS = [
  { level: 1, tons: 0, name: 'Тих град' },
  { level: 2, tons: 300, name: 'Оживен град' },
  { level: 3, tons: 1_500, name: 'Търговски център' },
  { level: 4, tons: 6_000, name: 'Логистичен възел' },
  { level: 5, tons: 20_000, name: 'Метрополия на товарите' },
] as const;

/** Pay over the board for loads leaving a city of this level. */
export const CITY_PAY = { perLevel: 0.03 } as const;

export function cityLevel(tons: number) {
  let i = 0;
  CITY_LEVELS.forEach((l, k) => {
    if (tons >= l.tons) i = k;
  });
  const cur = CITY_LEVELS[i]!;
  const next = CITY_LEVELS[i + 1] ?? null;
  return { ...cur, next, progress: next ? (tons - cur.tons) / (next.tons - cur.tons) : 1 };
}

export const cityPayFactor = (level: number) => 1 + Math.max(0, level - 1) * CITY_PAY.perLevel;

/**
 * Гроздобер (v1.10): from 1 September to 15 October harvest goods travel —
 * grapes, must, apples, pumpkins, walnuts — and pay more; ten harvest loads
 * in a season bring a badge and ТрансКоин.
 */
export const HARVEST = {
  from: '09-01',
  to: '10-15',
  contractShare: 0.18,
  rewardMultiplier: 1.2,
  loadsForBadge: 10,
  coins: 25,
  badge: 'harvest',
  goods: {
    pallets: ['Щайги с грозде', 'Ябълки в каси', 'Тикви', 'Буркани със зимнина', 'Орехи в чували'],
    refrigerated: ['Прясно грозде за трапеза', 'Гроздова мъст', 'Круши и дюли', 'Есенни гъби'],
    liquid: ['Гроздова мъст (цистерна)', 'Младо вино в цистерна'],
    bulk: ['Царевица от новата реколта', 'Слънчоглед от полето'],
  } as Record<string, string[]>,
} as const;

export const isHarvest = (now: Date) => inSeasonWindow(sofiaMonthDay(now), HARVEST);
