/**
 * Daily reward: claim once per Bulgarian calendar day. Consecutive days build a
 * streak through a 7-day cycle (day 7 is the best); missing a day starts over.
 */
import { periodWindow, sofiaParts } from './missions';

export interface DailyReward {
  cents: number;
  xp: number;
  coins: number;
}

export const DAILY_REWARDS: DailyReward[] = [
  { cents: 500_00, xp: 50, coins: 0 },
  { cents: 750_00, xp: 75, coins: 0 },
  { cents: 1_000_00, xp: 100, coins: 0 },
  { cents: 1_250_00, xp: 125, coins: 5 },
  { cents: 1_500_00, xp: 150, coins: 0 },
  { cents: 2_000_00, xp: 200, coins: 0 },
  { cents: 3_000_00, xp: 300, coins: 25 },
];

/** Day key in Bulgarian time, e.g. D2026-10-17. */
export const dayKey = (now: Date) => periodWindow('daily', now).key;

/** Key of the Bulgarian day before `now`'s. */
export function yesterdayKey(now: Date): string {
  const { y, m, d } = sofiaParts(now);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return `D${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}-${String(prev.getUTCDate()).padStart(2, '0')}`;
}

/** Where the player stands today: whether they can claim, which day of the cycle it is and the streak it continues. */
export function dailyState(streak: number, lastKey: string | null, now: Date) {
  const today = dayKey(now);
  const claimedToday = lastKey === today;
  const continues = lastKey === yesterdayKey(now);
  // The streak shown/continued: today's if claimed, else yesterday's (or 0 when broken).
  const current = claimedToday || continues ? streak : 0;
  const nextStreak = claimedToday ? streak : current + 1;
  const cycleDay = ((nextStreak - 1) % DAILY_REWARDS.length) + 1;
  return { today, claimedToday, streak: current, nextStreak, cycleDay, reward: DAILY_REWARDS[cycleDay - 1]! };
}
