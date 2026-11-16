import { inSeasonWindow, sofiaMonthDay } from './seasonal';

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
