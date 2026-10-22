import type { PowerUnitKind } from './catalog';
import type { UpgradeLevels } from './company';

/** The company's own trucks (v1.3): bought from the treasury, borrowed by the members. Game data. */
export const COMPANY_FLEET = {
  /** Places on the plot's parking per parking level. */
  perParkingLevel: 2,
  kinds: ['van', 'rigid'] as PowerUnitKind[],
} as const;

export const fleetLimit = (upgrades: UpgradeLevels) => COMPANY_FLEET.perParkingLevel * (upgrades.parking ?? 0);

/**
 * The company's own trailers (v1.4): bought from the treasury, borrowed by the
 * members like the company trucks. They carry the company's name; every trip
 * with one adds a bonus to the treasury (paid by the game, not the driver)
 * and more company experience. Game data.
 */
export const COMPANY_TRAILERS = {
  perParkingLevel: 2,
  /** Share of the trip's freight paid into the treasury as a bonus. */
  treasuryShare: 0.03,
  /** Company XP of the trip ×. */
  companyXp: 1.25,
} as const;

export const trailerLimit = (upgrades: UpgradeLevels) => COMPANY_TRAILERS.perParkingLevel * (upgrades.parking ?? 0);
