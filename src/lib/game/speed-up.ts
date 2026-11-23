import type { Segment } from './schedule';

/**
 * 1.3.2.2: a running delivery can be hurried with ТрансКоин — arrive now, or
 * halve the time left. The price follows the minutes left; an active VIP pays
 * less. Convoy trips cannot be hurried (the others wait for them). Game data.
 */
export const SPEED_UP = {
  /** One TC per this many minutes left (arrive now). */
  minutesPerCoin: 3,
  minCoins: 5,
  /** Halving the time left costs this share of „arrive now“. */
  halfShare: 0.6,
  vipDiscount: 0.2,
} as const;

export type SpeedUpMode = 'finish' | 'half';

/** What hurrying a trip with `msLeft` to go costs (TC). */
export function speedUpPrice(msLeft: number, mode: SpeedUpMode, vip: boolean): number {
  const minutes = Math.max(0, msLeft) / 60_000;
  const full = Math.max(SPEED_UP.minCoins, Math.ceil(minutes / SPEED_UP.minutesPerCoin));
  const price = mode === 'half' ? Math.max(SPEED_UP.minCoins, Math.ceil(full * SPEED_UP.halfShare)) : full;
  return vip ? Math.max(1, Math.round(price * (1 - SPEED_UP.vipDiscount))) : price;
}

/**
 * The schedule with what is left after `now` squeezed by `factor` (0 = it ends a
 * second from now, 0.5 = in half the time). What is already driven stays.
 */
export function hurrySchedule(segments: readonly Segment[], now: number, factor: number): Segment[] {
  const end = segments.at(-1)?.end ?? now;
  if (end <= now) return [...segments];
  const left = end - now;
  const target = Math.max(1_000, left * factor);
  const at = (t: number) => (t <= now ? t : Math.round(now + ((t - now) / left) * target));
  return segments.map((s) => ({ ...s, start: at(s.start), end: at(s.end) }));
}

/** 1.3.2.2: the money booster from the shop pays this share of the freight on top (outside the bonus cap). */
export const BOOSTERS = { moneyShare: 0.5 } as const;

/**
 * 1.3.2.2: a company booster — any member pays ТрансКоин and every member gets
 * +25 % of the freight on their runs for 24 hours (the personal +50 % booster
 * wins where both run; they do not add up). Bought again, it runs longer.
 */
export const COMPANY_BOOST = { coins: 900, hours: 24, share: 0.25 } as const;
