/**
 * Season pass: 30 levels filled by season points from deliveries. Every level
 * has a free reward; the premium track (bought with ТрансКоин) adds more.
 * Premium only makes rewards bigger — it never sells season points or ranks.
 */
export const PASS_LEVELS = 30;
export const PASS_POINTS_PER_LEVEL = 1000;
export const PASS_PRICE_COINS = 900;

export interface PassReward {
  cents?: number;
  coins?: number;
  vipDays?: number;
  xpBoostHours?: number;
}

export function rewardLabel(r: PassReward): string {
  const parts: string[] = [];
  if (r.cents) parts.push(`${(r.cents / 100).toLocaleString('bg-BG')} €`);
  if (r.coins) parts.push(`${r.coins} TC`);
  if (r.vipDays) parts.push(`VIP ${r.vipDays} ${r.vipDays === 1 ? 'ден' : 'дни'}`);
  if (r.xpBoostHours) parts.push(`×2 опит ${r.xpBoostHours} ч`);
  return parts.join(' + ');
}

/** Rewards per level (1-based): the free one and the premium one. */
export const PASS_REWARDS: { level: number; free: PassReward | null; premium: PassReward }[] = Array.from({ length: PASS_LEVELS }, (_, i) => {
  const level = i + 1;
  const free: PassReward | null = level % 10 === 0 ? { cents: level * 400_00, coins: 15 } : level % 2 === 0 ? { cents: 500_00 + level * 100_00 } : null;
  const premium: PassReward =
    level === PASS_LEVELS ? { coins: 200, vipDays: 7 }
    : level % 10 === 0 ? { coins: 80, vipDays: 3 }
    : level % 5 === 0 ? { coins: 40, xpBoostHours: 24 }
    : level % 3 === 0 ? { coins: 15 }
    : { cents: 1_000_00 + level * 150_00 };
  return { level, free, premium };
});

export const passLevel = (points: number) => Math.min(PASS_LEVELS, Math.floor(points / PASS_POINTS_PER_LEVEL));
