/** VIP status is granted by an administrator or bought in the shop until a date; it is active while that date is in the future. */
export function isVip(vipUntil: Date | string | null | undefined, now: Date | number): boolean {
  if (!vipUntil) return false;
  return new Date(vipUntil).getTime() > (typeof now === 'number' ? now : now.getTime());
}

export const VIP_MAX_DAYS = 3650;

/**
 * 1.3.3: the VIP a player shows next to the name — the VIP level (1–5) when there
 * is one, 0 for VIP time without a level, null without any VIP.
 */
export type VipTag = number | null;

export function vipTag(vipUntil: Date | string | null | undefined, level: number | null | undefined, now: Date | number): VipTag {
  if ((level ?? 0) > 0) return Math.min(5, level!);
  return isVip(vipUntil, now) ? 0 : null;
}

/** „VIP3“ for a level, „VIP“ for VIP time without a level. */
export const vipLabel = (tag: VipTag | boolean | undefined) => (typeof tag === 'number' && tag > 0 ? `VIP${tag}` : 'VIP');

/** Whether a tag (or an older true/false) means the player has VIP of any kind. */
export const hasVipTag = (tag: VipTag | boolean | undefined) => (typeof tag === 'number' ? true : !!tag);

/**
 * What VIP gives. Deliberately moderate: comfort and prestige, not a big edge —
 * season points and leaderboards are never boosted.
 */
export const VIP_PERKS = {
  /** Delivery XP multiplier. */
  xpMultiplier: 1.1,
  /** Percentage points off the rental share of rented trucks. */
  rentalShareReduction: 0.05,
  /** Discount on repairs and upgrades in the garage. */
  garageDiscount: 0.1,
  /** Extra vehicle places in every depot. */
  extraSlotsPerDepot: 1,
  /** Extra missions per period. */
  extraMissions: { daily: 1, weekly: 1, monthly: 0, season: 0 },
  /** Urgent shipments: VIPs may take them this long before everyone else. */
  urgentEarlyMs: 5 * 60_000,
  /** How long a VIP may hold a contract for themselves. */
  reservationMinutes: 10,
  /** 1.2.3 (shop_v2): the hold is longer and there is one more monthly mission. */
  reservationMinutesV2: 30,
  extraMonthlyMissionsV2: 1,
} as const;

/** Benefits shown on the VIP page (Bulgarian). */
export const VIP_BENEFITS: { group: string; items: string[] }[] = [
  { group: 'Бонуси', items: ['+10% опит от доставки', 'Наемът на камиона −5 процентни пункта', '−10% за ремонт и подобрения в гаража', '+1 място във всяко депо'] },
  { group: 'Мисии', items: ['+1 дневна и +1 седмична мисия', 'Безплатна смяна на една мисия всеки ден', 'Наградите от мисиите се взимат автоматично'] },
  { group: 'Удобства', items: ['Спешните доставки — 5 минути преди останалите', 'Запазване на поръчка за 10 минути', 'Запазени филтри на борсата'] },
  { group: 'Престиж', items: ['Златно име и бадж VIP навсякъде', 'Златна рамка на камионите ти на картата', 'Ексклузивни цветове за камионите'] },
];

/** Colours anyone may paint a truck in (repaint costs ТрансКоин for non-VIP). */
export const STANDARD_COLORS = ['#1d4ed8', '#e5e7eb', '#b91c1c', '#0f766e', '#f59e0b', '#111827', '#7c3aed', '#0891b2'];
/** Exclusive VIP colours. */
export const VIP_COLORS = ['#d4af37', '#c0c0c0', '#ff2d95', '#00e5ff', '#39ff14', '#ff6f00', '#6a0dad', '#e0115f'];
