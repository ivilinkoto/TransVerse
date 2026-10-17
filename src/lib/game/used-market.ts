import { resaleValueCents } from './economy';

/** Rules of the used-vehicle market between players. */
export const USED_MARKET = {
  /** Commission kept from the seller's price. */
  feeShare: 0.05,
  /** Open listings per player at once. */
  maxOpenListings: 3,
  /** A listing disappears after this many days. */
  listingDays: 7,
  /** Allowed price range: from half of the instant sale value up to the new price (stops money being moved between accounts). */
  minShareOfResale: 0.5,
  /** Suggested price: a bit above what the dealer pays on an instant sale. */
  suggestedShareOfResale: 1.3,
} as const;

export function usedPriceBounds(newPriceCents: number, condition: number, ageDays: number) {
  const resale = resaleValueCents(newPriceCents, condition, ageDays);
  const round = (c: number) => Math.round(c / 100_00) * 100_00;
  const min = Math.max(100_00, round(resale * USED_MARKET.minShareOfResale));
  const max = newPriceCents;
  const suggested = Math.min(max, Math.max(min, round(resale * USED_MARKET.suggestedShareOfResale)));
  return { resale, min, max, suggested };
}

export const marketFeeCents = (priceCents: number) => Math.round(priceCents * USED_MARKET.feeShare);
