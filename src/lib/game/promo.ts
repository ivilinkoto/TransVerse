/**
 * 1.1.4.3 „Промокодове“: the rules a code and its reward must follow.
 * The reward is game data (ТрансКоин, game money, items, VIP days) — never real money.
 */
export const PROMO = {
  /** Letters, digits and dashes; stored in capitals. */
  pattern: /^[A-Z0-9-]{4,32}$/,
  /** Wrong or right, a player may try this many codes per window. */
  attempts: 8,
  attemptWindowSeconds: 15 * 60,
  maxCoins: 1000,
  maxCents: 1_000_000_00,
  maxVipDays: 30,
  maxItems: 5,
  maxItemQty: 20,
  /** Codes made at once for one batch of single-use codes. */
  maxBatch: 500,
  /** A friend's invite code can be entered within this many days of sign-up. */
  inviteDays: 7,
} as const;

export type PromoReward = { coins?: number; cents?: number; vipDays?: number; items?: { itemId: string; qty: number }[] };

/** „ abc-12 “ → „ABC-12“ (what the player types is forgiving). */
export const normalizeCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, '');

export const rewardIsEmpty = (r: PromoReward) => !r.coins && !r.cents && !r.vipDays && !(r.items ?? []).some((i) => i.qty > 0);
