import type { PowerUnitKind } from './catalog';
import type { UpgradeLevels } from './company';

/** The company's own trucks (v1.3): bought from the treasury, borrowed by the members. Game data. */
export const COMPANY_FLEET = {
  /** Places on the plot's parking per parking level. */
  perParkingLevel: 2,
  kinds: ['van', 'rigid'] as PowerUnitKind[],
} as const;

export const fleetLimit = (upgrades: UpgradeLevels) => COMPANY_FLEET.perParkingLevel * (upgrades.parking ?? 0);
