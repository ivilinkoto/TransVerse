/**
 * Predictions (v1.5): who wins a company battle this week. Free — nothing
 * is staked; a right guess earns ТрансКоин paid by the game. A few picks a
 * week, until two days before the battle ends. Game data.
 */
export const PREDICTIONS = {
  perWeek: 3,
  coins: 5,
  /** Picks close this long before the battle ends. */
  closeHours: 48,
} as const;
