/**
 * Truck leasing: a down payment now, then weekly instalments that include
 * interest. Instalments are taken from the balance automatically; when two in
 * a row cannot be paid, the leasing company takes the truck back (what was
 * paid is lost). A leased truck cannot be sold until it is paid off.
 */
export const LEASE = {
  downShare: 0.2,
  payments: 10,
  /** Interest on the financed part, over the whole lease. */
  interestShare: 0.12,
  periodDays: 7,
  /** Missed instalments in a row before the truck is taken back. */
  maxMissed: 2,
  /** Paying off early saves this share of the interest still ahead. */
  payoffInterestDiscount: 0.5,
  /** Only trucks from this price up (vans are cheap enough to buy). */
  minPriceCents: 60_000_00,
  /** Leases running at the same time. */
  maxActive: 2,
} as const;

export interface LeaseTerms {
  downCents: number;
  weeklyCents: number;
  payments: number;
  /** Down payment plus all instalments. */
  totalCents: number;
}

export function leaseTerms(priceCents: number): LeaseTerms {
  const downCents = Math.round(priceCents * LEASE.downShare);
  const financed = priceCents - downCents;
  const weeklyCents = Math.ceil((financed * (1 + LEASE.interestShare)) / LEASE.payments);
  return { downCents, weeklyCents, payments: LEASE.payments, totalCents: downCents + weeklyCents * LEASE.payments };
}

/** What paying off the rest costs now: the principal left plus half of the interest left. */
export function payoffCents(lease: { priceCents: number; downCents: number; weeklyCents: number; payments: number; paid: number }): number {
  const left = lease.payments - lease.paid;
  if (left <= 0) return 0;
  const financed = lease.priceCents - lease.downCents;
  const principalLeft = (financed * left) / lease.payments;
  const interestLeft = lease.weeklyCents * left - principalLeft;
  return Math.max(0, Math.round(principalLeft + interestLeft * (1 - LEASE.payoffInterestDiscount)));
}
