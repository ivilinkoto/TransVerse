/**
 * Branches and loans (v1.4, game data).
 *
 * Branches: a company opens a small base in another real city — members get
 * loads of their own there (members only, better paid) and a bonus on every
 * delivery that ends in that city.
 *
 * Loans: a bank loan with weekly payments; how much and at what rate depends
 * on the player's credit rating, which grows with deliveries, level and paid
 * loans and drops with missed payments.
 */

export const BRANCH = {
  priceCents: 60_000_00,
  /** Branches by company level: [level, how many]. */
  slots: [[4, 1], [6, 2], [8, 3]] as const,
  /** Bonus on the pay of a member's delivery that ends in a branch city. */
  bonusShare: 0.05,
  /** Members-only loads kept open from every branch city, and how much better they pay. */
  loads: 3,
  loadMultiplier: 1.1,
  loadHours: 24,
} as const;

export const branchSlots = (companyLevel: number) => BRANCH.slots.reduce((n, [lvl, k]) => (companyLevel >= lvl ? k : n), 0 as number);

export const LOAN = {
  weeksOptions: [4, 8, 12] as const,
  /** Missed payments before the loan is in default (the rest is collected at once). */
  maxMissed: 2,
} as const;

export interface CreditInput {
  level: number;
  deliveries: number;
  onTimeShare: number;
  paidLoans: number;
  missedPayments: number;
  accountAgeDays: number;
}

/** Credit rating 300–850. */
export function creditRating(c: CreditInput): number {
  const score = 520 + Math.min(120, c.level * 6) + Math.min(80, c.deliveries / 10) + Math.round(c.onTimeShare * 60) + Math.min(80, c.paidLoans * 40) + Math.min(40, c.accountAgeDays / 3) - c.missedPayments * 60;
  return Math.max(300, Math.min(850, Math.round(score)));
}

export function creditTier(rating: number) {
  if (rating >= 760) return { label: 'Отличен', maxCents: 200_000_00, rateBps: 400 };
  if (rating >= 680) return { label: 'Много добър', maxCents: 120_000_00, rateBps: 650 };
  if (rating >= 600) return { label: 'Добър', maxCents: 60_000_00, rateBps: 900 };
  if (rating >= 520) return { label: 'Среден', maxCents: 20_000_00, rateBps: 1_200 };
  return { label: 'Слаб', maxCents: 0, rateBps: 0 };
}

/** Total to pay back and the weekly payment (interest for the whole term, longer terms a bit more). */
export function loanTerms(principalCents: number, rateBps: number, weeks: number) {
  const total = Math.round(principalCents * (1 + (rateBps / 10_000) * (1 + (weeks - 4) / 16)));
  return { totalCents: total, weeklyCents: Math.ceil(total / weeks) };
}
