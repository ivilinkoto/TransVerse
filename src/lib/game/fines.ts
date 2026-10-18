/**
 * Fines and insurance. Game rules, not real tariffs.
 *
 * A player may take a risk when sending a truck: drive on without the
 * driver's daily rest, or load up to 10 % over the payload. Each risk gives a
 * chance of a roadside check that ends in a fine. A fine is paid, or appealed
 * once (sometimes it is dropped, otherwise it grows); unpaid fines are taken
 * with a surcharge after the deadline.
 *
 * Insurance (per vehicle, 30 days) pays the road-assistance bills of
 * breakdowns. It does not pay fines.
 */

export type Violation = 'hours' | 'overload';

export const FINE_RULES = {
  /** Highest overload a player may choose, share of the payload. */
  overloadMax: 0.1,
  /** Chance that a risky trip is checked, per violation. */
  checkChance: { hours: 0.3, overload: 0.35 } as Record<Violation, number>,
  /** Overloaded trucks wear faster. */
  overloadWear: 1.25,
  appealWinChance: 0.4,
  /** A lost appeal adds this share (court costs). */
  appealLossShare: 0.25,
  dueHours: 48,
  /** Paid automatically after the deadline, with this surcharge. */
  latePayShare: 0.5,
} as const;

export const VIOLATION_LABELS: Record<Violation, string> = {
  hours: 'Кормуване без задължителна почивка',
  overload: 'Претоварване',
};

/** Fine in euro cents: a base plus per hour without rest / per percent overload. */
export function fineCents(violation: Violation, amount: number): number {
  if (violation === 'hours') return 400_00 + 120_00 * Math.max(1, Math.ceil(amount));
  return 300_00 + 40_00 * Math.max(1, Math.ceil(amount));
}

/** Overload as a percentage of the payload (0 when within it). */
export function overloadPercent(tons: number, payloadTons: number): number {
  if (payloadTons <= 0 || tons <= payloadTons) return 0;
  return ((tons - payloadTons) / payloadTons) * 100;
}

export function canOverload(tons: number, payloadTons: number): boolean {
  return tons > payloadTons && tons <= payloadTons * (1 + FINE_RULES.overloadMax) + 1e-9;
}

export const INSURANCE = {
  days: 30,
  baseCents: 150_00,
  /** Share of the vehicle's (and its trailer's) new price per 30 days. */
  valueShare: 0.0025,
} as const;

export function insurancePriceCents(valueCents: number): number {
  return Math.round((INSURANCE.baseCents + valueCents * INSURANCE.valueShare) / 100) * 100;
}

export const isInsured = (until: Date | null | undefined, at: Date) => !!until && until > at;
