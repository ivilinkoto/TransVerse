/**
 * Money transfers between players. Limited so that a second account cannot be
 * used to feed the first: a minimum level and account age, a daily limit, a
 * fee that leaves the game, and no transfers within the same network.
 */
export const TRANSFER_RULES = {
  minLevel: 5,
  minAccountDays: 7,
  /** Sent per rolling 24 hours, without the fee. */
  dailyLimitCents: 50_000_00,
  minCents: 100_00,
  /** Paid by the sender on top of the amount; it leaves the game. */
  feeShare: 0.03,
  noteMax: 140,
} as const;

export const transferFeeCents = (amountCents: number) => Math.ceil(amountCents * TRANSFER_RULES.feeShare);
