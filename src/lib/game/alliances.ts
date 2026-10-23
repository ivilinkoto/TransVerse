/**
 * Companies together (v1.5), game data:
 * - Alliances of 2–4 companies: a shared board, a weekly goal and a weekly
 *   battle against another alliance.
 * - Hauling contracts between companies: one company lets another's members
 *   haul its members-only loads (factory, branches) for a week, for a share.
 * - The company academy: new members do three training trips, the company
 *   and the mentor get a reward.
 * - The fuel station on the plot: cheaper fuel for the members starting from
 *   the base city; outside players fill up there too and the company earns.
 */
export const ALLIANCE = {
  maxCompanies: 4,
  nameMin: 3,
  nameMax: 30,
  /** The weekly goal: tonnes per member company. */
  goalTonsPerCompany: 300,
  goalRewardCents: 15_000_00,
  battleRewardCents: 25_000_00,
  inviteHours: 72,
} as const;

/**
 * The alliance hall (v1.5): a joint building in the leader company's base
 * city. Members of every company in the alliance haul building materials
 * (pallets and steel) there; each level adds a bonus to all their trips.
 */
export const ALLIANCE_HALL = {
  /** Tonnes of materials for each level (1, 2, 3). */
  tons: [200, 400, 700] as const,
  /** Bonus on the freight of every member of the alliance, per level. */
  bonusPerLevel: 0.01,
  cargo: ['pallets', 'steel'] as readonly string[],
} as const;

export const hallBonusShare = (level: number) => Math.max(0, Math.min(ALLIANCE_HALL.tons.length, level)) * ALLIANCE_HALL.bonusPerLevel;
/** Tonnes needed for the next level (null at the top). */
export const hallNextTons = (level: number) => ALLIANCE_HALL.tons[level] ?? null;

export const COMPANY_CONTRACT = {
  days: 7,
  /** The hauler's share of each load's freight, paid from the client's treasury. */
  minShare: 0.05,
  maxShare: 0.3,
  inviteHours: 48,
} as const;

export const ACADEMY = {
  /** Who can enrol: members who joined at most this long ago. */
  joinedDays: 30,
  courses: 3,
  /** A course: an on-time delivery at least this long. */
  minKm: 200,
  /** Rewards: XP for the student, ТрансКоин for the mentor, money into the treasury (from the game). */
  studentXp: 1_500,
  mentorCoins: 30,
  treasuryCents: 5_000_00,
  mentorMinLevel: 10,
} as const;

export const FUEL_STATION = {
  /** Fuel discount for members whose trip starts in the base city, by level. */
  discount: [0, 0.06, 0.1, 0.14] as const,
  /** Share of the fuel of other players starting there that the company earns (paid by the game). */
  margin: 0.03,
} as const;

export const fuelDiscount = (level: number) => FUEL_STATION.discount[Math.max(0, Math.min(3, level))] ?? 0;
