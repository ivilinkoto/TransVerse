/**
 * 1.2.6: ТрансКоин from rewards get fewer step by step, so the shop keeps its meaning.
 * One factor by date for every reward; what was bought, gifted, refunded, given by
 * the team or by a promo code is never touched. Change the steps here (each can be
 * moved or undone without touching the rewards themselves).
 */
export const COIN_TAPER_STEPS: { from: string; factor: number }[] = [
  { from: '2026-11-20T10:00:00+02:00', factor: 0.85 },
  { from: '2026-12-01T00:00:00+02:00', factor: 0.7 },
  { from: '2027-01-01T00:00:00+02:00', factor: 0.6 },
];

/** Reasons that are not rewards: bought, gifted, refunded, the team's, promo codes, sales and bids. */
export const UNTAPERED_REASONS: readonly string[] = ['admin_grant', 'admin_remove', 'purchase', 'shop', 'gift_received', 'refund', 'payment_refund', 'promo', 'item_sale', 'plate_auction'];

/** The share of a reward in ТрансКоин paid out at `now` (1 before the first step). */
export function coinTaperFactor(now: Date): number {
  let factor = 1;
  for (const s of COIN_TAPER_STEPS) if (now >= new Date(s.from)) factor = s.factor;
  return factor;
}

/** What a reward of `amount` TC pays at `now` (at least 1 for a positive reward). */
export function taperCoins(amount: number, now: Date, reason?: string): number {
  if (amount <= 0 || (reason && UNTAPERED_REASONS.includes(reason))) return amount;
  return Math.max(1, Math.round(amount * coinTaperFactor(now)));
}
