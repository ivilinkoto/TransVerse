/**
 * The share exchange (v1.8), game money only:
 * - A company owner lists the company (at least 14 days old, 2 members).
 *   It has 1 000 shares; players outside the company may hold up to 400 of
 *   them, at most 100 each. A purchase pays the price into the company's
 *   treasury (+1 % fee that goes nowhere).
 * - The price follows the company's real results: each day it moves towards
 *   (treasury + 10 × the members' contributions of the last 28 days) / 1 000,
 *   at most ±10 % a day, never below 1 лв.
 * - Bought shares are held at least 7 days; a sale pays 97 % of the price.
 * - Every Monday the treasury pays dividends: 20 % of the week's
 *   contributions, for the share held outside the company.
 */
export const SHARES = {
  total: 1_000,
  outsideMax: 400,
  perPlayerMax: 100,
  minAgeDays: 14,
  minMembers: 2,
  feeShare: 0.01,
  sellShare: 0.97,
  lockDays: 7,
  maxDailyMove: 0.1,
  minPriceCents: 1_00,
  contributionsWeight: 10,
  windowDays: 28,
  dividendShare: 0.2,
} as const;

/** Today's price from yesterday's and the company's value (cents). */
export function nextSharePrice(previousCents: number, treasuryCents: number, contributionsCents: number): number {
  const target = Math.max(SHARES.minPriceCents, Math.round((Math.max(0, treasuryCents) + SHARES.contributionsWeight * Math.max(0, contributionsCents)) / SHARES.total));
  if (previousCents <= 0) return target;
  const lo = Math.round(previousCents * (1 - SHARES.maxDailyMove));
  const hi = Math.round(previousCents * (1 + SHARES.maxDailyMove));
  return Math.max(SHARES.minPriceCents, Math.min(hi, Math.max(lo, target)));
}

/** The week's dividend pool for the shares outside the company (cents). */
export const dividendPool = (weekContributionsCents: number, outsideShares: number) => Math.floor((Math.max(0, weekContributionsCents) * SHARES.dividendShare * outsideShares) / SHARES.total);
