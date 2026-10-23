/**
 * Rare plates (v1.6), game data: very short plates cannot be bought in the
 * shop; one of them goes under the hammer each week for ТрансКоин. The
 * winner fits it on an own truck whenever they like.
 */
export const RARE_PLATES = ['1', '7', '777', 'TV', '9', '77', 'A', '99', '100', '3', 'TV 1', '555', '8', '88', 'Z', '2', '22', 'X', '5', '333', 'BG 1', '6', '66', 'K', '4', '44', 'M', '999', 'TV 7', '0'] as const;

/** A plate that only the auction gives: one of the list, or a single sign. */
export const isRarePlate = (plate: string) => {
  const p = plate.trim().toUpperCase();
  return p.length === 1 || (RARE_PLATES as readonly string[]).includes(p);
};

export const PLATE_AUCTION = {
  startCoins: 200,
  /** A new bid beats the last by at least this share (and at least 10 TC). */
  stepShare: 0.1,
  minStep: 10,
  /** A bid this close to the end moves the end this far (v1.7). */
  extendMs: 10 * 60_000,
} as const;

export const nextMinBid = (current: number | null) => (current ? current + Math.max(PLATE_AUCTION.minStep, Math.ceil(current * PLATE_AUCTION.stepShare)) : PLATE_AUCTION.startCoins);
