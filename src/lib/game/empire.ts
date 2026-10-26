/**
 * Holdings, territories and legacy (v2.0 "Светът се отваря"), game data:
 * - Holding: a company of level 6+ founds one (from its treasury) and invites
 *   up to five other companies. Every member company's driver earns a little
 *   more on a load to a city where any company of the holding has its base or
 *   a branch (the network). Each Monday the subsidiaries pay the parent a
 *   share of last week's contributions. A subsidiary may leave at any time,
 *   but not within a week of joining.
 * - Territory: the company whose members brought the most tonnes into a
 *   region (first-level, real) in a week holds it the next week; its members
 *   earn a little more on loads into that region.
 * - Legacy (New Game+): from level 25 a player may start the career again —
 *   level 1, the starting money and a rented truck — and keeps a legacy star
 *   that pays a little more on every load, for good (up to five stars).
 */
export const HOLDING = {
  minCompanyLevel: 6,
  foundCents: 50_000_00,
  maxSubsidiaries: 5,
  networkShare: 0.02,
  feeShare: 0.05,
  minStayDays: 7,
  nameMax: 40,
} as const;

export const TERRITORY = { minTons: 30, bonusShare: 0.03 } as const;

export const LEGACY = { minLevel: 25, maxStars: 5, bonusPerStar: 0.03, cooldownDays: 30 } as const;

/** The legacy share of a load's reward for a number of stars. */
export const legacyShare = (stars: number) => Math.min(LEGACY.maxStars, Math.max(0, stars)) * LEGACY.bonusPerStar;

/** A region's key: the country and the region's (English, GeoNames) name. */
export const regionKey = (country: string, region: string | null | undefined) => (region ? `${country}|${region}` : null);
