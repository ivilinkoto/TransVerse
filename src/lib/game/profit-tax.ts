/**
 * 1.3.2.1 „Честна монета“: a weekly tax on a player's profit (Monday to Monday,
 * Sofia), progressive so that it hits the big fleets, not the new players.
 * Profit is every money movement of the week except transfers between players,
 * the team's adjustments, loans, the starting capital, deposits into a
 * company's treasury and the tax itself. Buying trucks lowers it (it is spent);
 * selling them raises it. Game data.
 */
export const PROFIT_TAX = {
  /** The first week taxed (charged on the Monday after it). */
  firstWeek: 'W2026-11-23',
  /** Each bracket: the rate on the part of the profit above `from` (lv.). */
  brackets: [
    { from: 0, rate: 0 },
    { from: 150_000, rate: 0.1 },
    { from: 750_000, rate: 0.2 },
    { from: 3_000_000, rate: 0.3 },
  ],
  /** Not profit: money moved, not earned or spent in the game. */
  excluded: ['transfer_in', 'transfer_out', 'admin_adjustment', 'loan', 'starting_capital', 'legacy_reset', 'treasury_deposit', 'profit_tax'],
} as const;

/** The tax on a week's profit (cents). */
export function profitTaxCents(profitCents: number): number {
  if (profitCents <= 0) return 0;
  const b = PROFIT_TAX.brackets;
  let tax = 0;
  for (let i = 0; i < b.length; i++) {
    const lo = b[i]!.from * 100;
    const hi = i + 1 < b.length ? b[i + 1]!.from * 100 : Infinity;
    if (profitCents > lo) tax += (Math.min(profitCents, hi) - lo) * b[i]!.rate;
  }
  return Math.round(tax);
}

/** The share of the profit taken (for the finance page). */
export const effectiveRate = (profitCents: number) => (profitCents > 0 ? profitTaxCents(profitCents) / profitCents : 0);
