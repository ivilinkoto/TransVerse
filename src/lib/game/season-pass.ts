import { t, intlLocale } from '@/i18n/t';
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
  if (r.cents) parts.push(t('{0} лв.', (r.cents / 100).toLocaleString(intlLocale())));
  if (r.coins) parts.push(`${r.coins} TC`);
  if (r.vipDays) parts.push(`VIP ${r.vipDays} ${r.vipDays === 1 ? t('ден') : t('дни')}`);
  if (r.xpBoostHours) parts.push(t('×2 опит {0} ч', r.xpBoostHours));
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

// ───────────── 1.2.5 „Първи сняг“: the pass from this season on (version 2) ─────────────
/**
 * 50 levels, each dearer than the one before (2 000 points, then +150 a level:
 * about 284 000 for all 50), weekly pass tasks on top, and elite levels after
 * 50 (one every 10 000 points). Rewards are mostly items, cosmetics and titles;
 * money and ТрансКоин are a small part. The season's rules carry `pass: 2`.
 */
export interface PassRewardV2 extends PassReward {
  /** Inventory items (cases, vouchers, frames, the season paint…). */
  items?: { itemId: string; qty: number }[];
  /** A title (a badge that can be shown next to the name). */
  title?: string;
  /** A truck model given for free (the season truck). */
  truck?: string;
}

export const PASS_V2 = {
  levels: 50,
  base: 2_000,
  step: 150,
  /** After level 50: an elite level every this many points. */
  elitePoints: 10_000,
  priceCoins: 1_000,
} as const;

export type PassVersion = 1 | 2;
export const passVersion = (rules: unknown): PassVersion => ((rules as { pass?: number } | null)?.pass === 2 ? 2 : 1);

/** Points needed to reach level n (0 for level 0). */
export function levelStart(n: number, v: PassVersion): number {
  if (v === 1) return n * PASS_POINTS_PER_LEVEL;
  return PASS_V2.base * n + (PASS_V2.step * n * (n - 1)) / 2;
}

export const passLevels = (v: PassVersion) => (v === 1 ? PASS_LEVELS : PASS_V2.levels);
export const passPrice = (v: PassVersion) => (v === 1 ? PASS_PRICE_COINS : PASS_V2.priceCoins);

export function passLevelOf(points: number, v: PassVersion): number {
  const max = passLevels(v);
  let n = 0;
  while (n < max && points >= levelStart(n + 1, v)) n++;
  return n;
}

/** Elite levels after the last one (version 2 only). */
export const eliteLevels = (points: number, v: PassVersion) => (v === 2 ? Math.max(0, Math.floor((points - levelStart(PASS_V2.levels, 2)) / PASS_V2.elitePoints)) : 0);
/** The reward of the n-th elite level (1-based): a silver case, and a gold one every fifth. */
export const eliteReward = (n: number): PassRewardV2 => ({ items: [{ itemId: n % 5 === 0 ? 'case_gold' : 'case_silver', qty: 1 }] });

const it = (itemId: string, qty = 1): PassRewardV2 => ({ items: [{ itemId, qty }] });

/** „Първи сняг“: free every other level, premium every level. */
const FREE_V2: Record<number, PassRewardV2> = {
  2: { cents: 2_000_00 }, 4: it('coffee', 2), 6: it('repair_kit'), 8: it('fuel_voucher', 2), 10: it('case_bronze'),
  12: { cents: 4_000_00 }, 14: it('energy_drink'), 16: it('cargo_cover'), 18: it('antifreeze'), 20: it('case_silver'),
  22: it('paint_firstsnow'), 24: it('ice_scraper'), 26: { cents: 8_000_00 }, 28: it('coffee', 3), 30: { coins: 20 },
  32: it('queue_ticket'), 34: it('driver_handbook'), 36: it('repair_kit', 2), 38: { cents: 12_000_00 }, 40: it('case_gold'),
  42: it('thermos'), 44: it('coin_pouch'), 46: it('case_silver'), 48: { cents: 20_000_00 }, 50: { title: 'first-snow-50', items: [{ itemId: 'case_gold', qty: 1 }] },
};
const PREMIUM_V2: Record<number, PassRewardV2> = {
  1: it('coffee', 3), 3: it('repair_kit', 2), 5: { coins: 15 }, 7: it('fuel_voucher', 3), 9: it('energy_drink', 2),
  10: it('frost_frame'), 11: it('case_bronze'), 13: it('cargo_cover', 2), 15: { title: 'first-snow-icebreaker' }, 17: it('queue_ticket', 2),
  19: { xpBoostHours: 24 }, 20: it('case_gold'), 21: it('thermos'), 23: it('driver_handbook', 2), 25: { coins: 40 },
  27: it('power_nap'), 29: it('case_silver'), 30: { vipDays: 3 }, 31: it('coin_pouch', 2), 33: it('repair_kit', 3),
  35: { coins: 60 }, 37: it('case_silver'), 39: it('treasure_map'), 40: it('case_gold'), 41: it('cab_coffee'),
  43: { xpBoostHours: 48 }, 45: { coins: 25 }, 47: it('case_gold'), 49: { coins: 100 }, 50: { truck: 'rila-nordik-plow', vipDays: 7 },
};

/** Every level of version 2: the free reward (some levels), and the premium one (most levels, the rest small money). */
export const PASS_REWARDS_V2: { level: number; free: PassRewardV2 | null; premium: PassRewardV2 }[] = Array.from({ length: PASS_V2.levels }, (_, i) => {
  const level = i + 1;
  return { level, free: FREE_V2[level] ?? null, premium: PREMIUM_V2[level] ?? { cents: 1_500_00 + level * 150_00 } };
});

/** A version-2 reward in words (items by name, the title, the truck). */
export function rewardLabelV2(r: PassRewardV2, itemName: (id: string) => string, titleName: (id: string) => string): string {
  const parts: string[] = [];
  const base = rewardLabel(r);
  if (base) parts.push(base);
  for (const i of r.items ?? []) parts.push(i.qty > 1 ? `${itemName(i.itemId)} ×${i.qty}` : itemName(i.itemId));
  if (r.title) parts.push(t('Титла „{0}“', titleName(r.title)));
  if (r.truck) parts.push(t('Камион Rila Nordik 540 Снегорин'));
  return parts.join(' + ');
}

export const passRewards = (v: PassVersion): { level: number; free: PassRewardV2 | null; premium: PassRewardV2 }[] => (v === 1 ? PASS_REWARDS : PASS_REWARDS_V2);
