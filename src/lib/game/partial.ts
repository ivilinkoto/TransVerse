/**
 * Partial loads: a truck smaller than the load takes only what it can carry.
 * The pay is the same per tonne (the share of the tonnes), and the rest of the
 * load stays on the board for other trucks.
 */

export const PARTIAL = {
  /** The smallest part a truck may take. */
  minTons: 0.5,
  /** What must stay on the board (otherwise the truck takes the whole load). */
  minRestTons: 0.5,
} as const;

const tenth = (t: number) => Math.floor(t * 10 + 1e-6) / 10;

/** Ordinary board loads only: not urgent, not own goods, tenders, auctions, clients, construction, groupage or the load of the day. */
export function canSplit(c: { urgent: boolean; tradeCompanyId?: string | null; tenderId?: string | null; auctionId?: string | null; clientContractId?: string | null; constructionId?: string | null; stops?: readonly unknown[] | null; featured?: string | null }): boolean {
  return !c.urgent && !c.tradeCompanyId && !c.tenderId && !c.auctionId && !c.clientContractId && !c.constructionId && !c.stops?.length && !c.featured;
}

/** The biggest part a truck with this payload may take (null when it carries the whole load or the part is too small). */
export function partTons(weightTons: number, payloadTons: number): number | null {
  if (payloadTons + 1e-9 >= weightTons) return null;
  const tons = Math.min(tenth(payloadTons), tenth(weightTons - PARTIAL.minRestTons));
  return tons >= PARTIAL.minTons ? tons : null;
}

/** Pay for `tons` of the load: its share of the tonnes. */
export function partRewardCents(load: { weightTons: number; rewardCents: number }, tons: number): number {
  return Math.round((load.rewardCents * tons) / load.weightTons);
}

/** Why `tons` is not a valid part of the load for this payload (null when it is). */
export function partError(weightTons: number, tons: number, payloadTons: number): string | null {
  if (!(tons >= PARTIAL.minTons)) return `Най-малката част е ${PARTIAL.minTons} т.`;
  if (tons > payloadTons + 1e-9) return `Камионът побира ${payloadTons} т.`;
  if (tons > weightTons - PARTIAL.minRestTons + 1e-9) return 'Вземи целия товар.';
  return null;
}
