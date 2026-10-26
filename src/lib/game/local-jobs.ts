/**
 * 1.1.2: loads waiting where the player's trucks are. Every free truck with a
 * driver — and every truck that arrives within the hour — finds this many
 * open loads it can take in that city, each to a different destination.
 */
export const LOCAL_JOBS = {
  perTruck: 3,
  /** Trucks on a trip that arrive within this many minutes count for their destination. */
  arrivingWithinMin: 60,
  /** The guaranteed loads stay on the board this long. */
  ttlHours: 12,
  /** Trucks looked at per worker run (the most recently active players first). */
  maxTrucks: 500,
  /** New loads per worker run at most; the rest come on the next run (each minute). */
  maxNewPerRun: 120,
} as const;
