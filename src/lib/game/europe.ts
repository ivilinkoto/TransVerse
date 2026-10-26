/**
 * Trans-European loads (v1.7), game data:
 * - Trans-European loads: a few loads of 2 500 km and more between the ends
 *   of the continent; better paid, only for a two-driver crew. The first one
 *   on time earns a badge.
 * (Cabotage, the limit on domestic loads abroad, was taken out in 1.1.2.)
 */
export const TRANS_EUROPE = {
  minKm: 2_500,
  open: 4,
  multiplier: 1.3,
  ttlHours: 30,
  tons: [12, 24] as [number, number],
  badge: 'trans-europe',
} as const;

/**
 * Кралят на държавата (v1.7): the player who brought the most tons into a
 * country in a calendar month (Sofia) holds its title for the next month.
 */
export const COUNTRY_KINGS = { minTons: 20, coins: 25 } as const;
