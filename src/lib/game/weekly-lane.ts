/**
 * 1.2.3 „Договор на седмицата“ (feature `weekly_lane`): one lane for the whole
 * game each ISO week, with better-paid loads on it all week; the first players
 * to deliver one on time get a badge and ТрансКоин.
 */
export const WEEKLY_LANE = {
  multiplier: 1.3,
  /** Loads kept open on the lane at any time. */
  openLoads: 4,
  /** How many players are rewarded each week. */
  winners: 20,
  coins: 50,
  badge: 'weekly-lane',
  minKm: 300,
  maxKm: 900,
  cargo: 'pallets' as const,
  ttlHours: 24,
  goods: ['Мебели', 'Авточасти', 'Битова техника', 'Напитки', 'Опаковки'],
} as const;

export const weeklyLaneTag = (week: string) => `weekly-lane:${week}`;
export const isWeeklyLaneTag = (tag: string | null | undefined) => !!tag && tag.startsWith('weekly-lane:');
