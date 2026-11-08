/**
 * 1.2.3.4: the player asks for new loads around their free trucks. Once every
 * 24 hours it is free; after that each refresh costs ТрансКоин, twice the last
 * one, until the free one comes back.
 */
export const BOARD_REFRESH = {
  freeEveryHours: 24,
  /** New loads per city of the player's free trucks. */
  perCity: 3,
  /** Cities looked at (the player's free trucks). */
  maxCities: 6,
  firstCoins: 5,
  factor: 2,
  maxCoins: 160,
} as const;

/** The price of the next refresh: 0 when the free one is ready, else first × factor^paid (capped). */
export function refreshPrice(state: { freeAt: string | null; paid: number } | null, now: Date): number {
  if (!state?.freeAt || now.getTime() - new Date(state.freeAt).getTime() >= BOARD_REFRESH.freeEveryHours * 3_600_000) return 0;
  return Math.min(BOARD_REFRESH.maxCoins, BOARD_REFRESH.firstCoins * BOARD_REFRESH.factor ** state.paid);
}
