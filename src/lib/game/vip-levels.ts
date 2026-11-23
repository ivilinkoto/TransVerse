/**
 * 1.3.2.2 „VIP нива“: VIP0–VIP5 by the real money a player has spent in the
 * shop (paid, not refunded, euro). The level is kept for good and its bonuses
 * always apply — on top of the time-limited VIP. Everyone with VIP when the
 * levels came is VIP5 for good (users.vip_level_floor). Game data.
 */
export interface VipLevel {
  level: number;
  /** Spent from this much on (euro cents). */
  fromCents: number;
  /** Extra delivery XP (share). */
  xp: number;
  /** Off garage repairs and upgrades (share). */
  garage: number;
  /** Extra pay on each delivery (share of the freight; inside the 40 % bonus cap). */
  pay: number;
  /** Extra places in every depot. */
  depotSlots: number;
}

export const VIP_LEVELS: VipLevel[] = [
  { level: 0, fromCents: 0, xp: 0, garage: 0, pay: 0, depotSlots: 0 },
  { level: 1, fromCents: 500, xp: 0.02, garage: 0.02, pay: 0.01, depotSlots: 0 },
  { level: 2, fromCents: 2_000, xp: 0.04, garage: 0.04, pay: 0.02, depotSlots: 0 },
  { level: 3, fromCents: 5_000, xp: 0.06, garage: 0.06, pay: 0.03, depotSlots: 1 },
  { level: 4, fromCents: 10_000, xp: 0.08, garage: 0.08, pay: 0.04, depotSlots: 1 },
  { level: 5, fromCents: 20_000, xp: 0.1, garage: 0.1, pay: 0.05, depotSlots: 2 },
];
export const MAX_VIP_LEVEL = VIP_LEVELS.length - 1;

/** The level for what a player has spent (euro cents). */
export const levelForSpent = (spentCents: number) => [...VIP_LEVELS].reverse().find((l) => spentCents >= l.fromCents)!.level;

/** The bonuses of a level (0 when out of range). */
export const vipLevel = (level: number | null | undefined): VipLevel => VIP_LEVELS[Math.max(0, Math.min(MAX_VIP_LEVEL, level ?? 0))]!;

/** What is left to the next level (null at the top). */
export function nextVipLevel(spentCents: number, level: number) {
  const next = VIP_LEVELS[level + 1];
  return next ? { level: next.level, leftCents: Math.max(0, next.fromCents - spentCents) } : null;
}

/**
 * 1.3.3: what each VIP level unlocks on top of its bonuses (a new feature or
 * a bigger limit), shown in the shop once the feature is out.
 */
export interface VipUnlock {
  level: number;
  label: string;
  /** Shown once this feature is out (FEATURES). */
  feature: string;
}

export const VIP_UNLOCKS: VipUnlock[] = [
  { level: 1, label: 'Два наети влака наведнъж', feature: 'trains' },
  { level: 2, label: 'Премиум камиони за ТрансКоин (Пазар)', feature: 'premium_trucks' },
  { level: 2, label: 'Три наети влака наведнъж', feature: 'trains' },
  { level: 3, label: 'Собствени влакове и пускане под наем', feature: 'trains' },
  { level: 4, label: 'Още един собствен влак', feature: 'trains' },
  { level: 5, label: 'Още два собствени влака', feature: 'trains' },
];

/** The unlocks of one level, among the features that are out. */
export const unlocksAt = (level: number, live: (feature: string) => boolean) => VIP_UNLOCKS.filter((u) => u.level === level && live(u.feature));
