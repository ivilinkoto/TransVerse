/**
 * Trans-European loads and cabotage (v1.7), game data:
 * - Trans-European loads: a few loads of 2 500 km and more between the ends
 *   of the continent; better paid, only for a two-driver crew. The first one
 *   on time earns a badge.
 * - Cabotage (the real EU rule, simplified): in a country that is not the
 *   home of the company, at most three domestic loads within seven days.
 */
export const TRANS_EUROPE = {
  minKm: 2_500,
  open: 4,
  multiplier: 1.3,
  ttlHours: 30,
  tons: [12, 24] as [number, number],
  badge: 'trans-europe',
} as const;

export const CABOTAGE = { maxLoads: 3, days: 7 } as const;
