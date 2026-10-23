/**
 * Trailers for hire between players (v1.6), game data: an owner offers an
 * idle own trailer at a price per day; another player hires it for 1–7
 * days and pays up front. The trailer goes back by itself at the end (once
 * it is not on a trip), with its wear and where it stands.
 */
export const TRAILER_HIRE = {
  maxDays: 7,
  minPricePerDayCents: 10_00,
  maxPricePerDayCents: 2_000_00,
} as const;
