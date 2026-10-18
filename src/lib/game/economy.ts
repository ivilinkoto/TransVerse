import { CARGO, type CargoType } from './cargo';
import { UPGRADES, type PowerUnitModel, type TrailerModel, type UpgradeId } from './catalog';

/**
 * Economic formulas. All money is integer euro cents. These functions are
 * pure so they can be unit-tested and shown in the UI as estimates; the server
 * re-computes them when it settles anything.
 */
export const ECONOMY = {
  /** New players start as independent drivers with a rented truck and a little cash. */
  startingBalanceCents: 1_500_00,
  /** Rental: share of the freight reward plus a per-km charge (incl. empty km). */
  rentalShare: 0.45,
  rentalCentsPerKm: 10,
  /** Founding a transport company. */
  foundingFeeCents: 5_000_00,
  foundingMinLevel: 2,
  foundingMinDeliveries: 3,
  /** One-off bonus for finishing the onboarding tutorial. */
  tutorialRewardCents: 1_000_00,
  tutorialRewardXp: 200,
  handlingFeeCents: 80_00,
  fuelPriceCentsPerLitre: 155,
  /** Game estimate of heavy-vehicle tolls on tolled routes. */
  tollCentsPerKm: 13,
  latePenaltyShare: 0.3,
  earlyBonusShare: 0.05,
  /** Share of the delivery window left to earn the punctuality bonus. */
  earlyBonusThreshold: 0.25,
  wearPerThousandKm: 1.6,
  minConditionForJobs: 25,
  repairCentsPerPointPerThousandValue: 1.2,
  resaleShare: 0.65,
  demandFloor: 0.5,
  demandCeiling: 1.6,
  demandDropPerTon: 0.012,
  demandRecoveryPerHour: 0.01,
  depotSlotsDefault: 3,
  depotPriceCents: 45_000_00,
  depotSlotUpgradeCents: 18_000_00,
} as const;

export function rewardCents(cargo: CargoType, tons: number, km: number, marketMultiplier: number): number {
  const def = CARGO[cargo];
  const perKm = def.baseCentsPerKm + def.centsPerTonKm * tons;
  return Math.round(ECONOMY.handlingFeeCents + km * perKm * marketMultiplier);
}

export function upgradeFactor(upgrades: readonly string[], key: 'fuel' | 'wear' | 'xp'): number {
  return upgrades.reduce((f, id) => f * (UPGRADES[id as UpgradeId]?.[key] ?? 1), 1);
}

export interface TripCostInput {
  unit: PowerUnitModel;
  trailer: TrailerModel | null;
  upgrades: readonly string[];
  condition: number;
  /** Driver skill 1..5 */
  driverSkill: number;
  /** Crew skills: fuel and wear factors (default 1). */
  crewFuel?: number;
  crewWear?: number;
  emptyKm: number;
  loadedKm: number;
  tons: number;
  payloadTons: number;
  tolledRoute: { empty: boolean; loaded: boolean };
  /** Diesel price on each leg (cents per litre, by the countries it crosses); default ECONOMY.fuelPriceCentsPerLitre. */
  fuelPrice?: { empty: number; loaded: number };
}

export interface TripCosts {
  fuelCents: number;
  /** Litres burnt on the whole trip. */
  fuelLitres?: number;
  tollCents: number;
  maintenanceCents: number;
  totalCents: number;
  wear: number;
}

export function tripCosts(input: TripCostInput): TripCosts {
  const { unit, trailer } = input;
  const loadShare = input.payloadTons > 0 ? Math.min(1, input.tons / input.payloadTons) : 0;
  const efficiency = upgradeFactor(input.upgrades, 'fuel') * (1 - 0.03 * (input.driverSkill - 1)) * (input.crewFuel ?? 1) * (1 + (100 - input.condition) / 400);
  const drag = trailer ? trailer.dragFuel : 0;
  const emptyL = (input.emptyKm / 100) * (unit.fuelEmpty + drag * 0.5);
  const loadedL = (input.loadedKm / 100) * (unit.fuelEmpty + (unit.fuelFull - unit.fuelEmpty) * loadShare + drag);
  const price = input.fuelPrice ?? { empty: ECONOMY.fuelPriceCentsPerLitre, loaded: ECONOMY.fuelPriceCentsPerLitre };
  const fuelCents = Math.round((emptyL * price.empty + loadedL * price.loaded) * efficiency);

  const tolledKm = unit.tolled ? (input.tolledRoute.empty ? input.emptyKm : 0) + (input.tolledRoute.loaded ? input.loadedKm : 0) : 0;
  const tollCents = Math.round(tolledKm * ECONOMY.tollCentsPerKm);
  const km = input.emptyKm + input.loadedKm;
  const maintenanceCents = Math.round(km * unit.maintenanceCentsPerKm);
  const wear = (km / 1000) * ECONOMY.wearPerThousandKm * upgradeFactor(input.upgrades, 'wear') * (input.crewWear ?? 1);
  return { fuelCents, fuelLitres: Math.round((emptyL + loadedL) * efficiency), tollCents, maintenanceCents, totalCents: fuelCents + tollCents + maintenanceCents, wear };
}

export interface Settlement {
  rewardCents: number;
  bonusCents: number;
  penaltyCents: number;
  late: boolean;
}

/** Final payout for a delivery that finished at `completedAt`. */
export function settle(reward: number, startedAt: number, deadlineAt: number, completedAt: number): Settlement {
  const late = completedAt > deadlineAt;
  const window = deadlineAt - startedAt;
  const spare = window > 0 ? (deadlineAt - completedAt) / window : 0;
  return {
    rewardCents: reward,
    late,
    penaltyCents: late ? Math.round(reward * ECONOMY.latePenaltyShare) : 0,
    bonusCents: !late && spare >= ECONOMY.earlyBonusThreshold ? Math.round(reward * ECONOMY.earlyBonusShare) : 0,
  };
}

export function repairCostCents(vehiclePriceCents: number, condition: number): number {
  const missing = Math.max(0, 100 - condition);
  return Math.round((missing * vehiclePriceCents * ECONOMY.repairCentsPerPointPerThousandValue) / 1000);
}

export function resaleValueCents(priceCents: number, condition: number, ageDays: number): number {
  const ageFactor = Math.max(0.35, 1 - ageDays / 3650);
  return Math.round(priceCents * ECONOMY.resaleShare * (0.4 + 0.6 * (condition / 100)) * ageFactor);
}

export function clampDemand(value: number): number {
  return Math.min(ECONOMY.demandCeiling, Math.max(ECONOMY.demandFloor, value));
}

/** Per-delivery fee for a rented vehicle — replaces fuel, tolls, maintenance and wear. */
export function rentalFeeCents(rewardCents: number, totalKm: number, shareReduction = 0): number {
  const share = Math.max(0.2, ECONOMY.rentalShare - shareReduction);
  return Math.round(rewardCents * share + totalKm * ECONOMY.rentalCentsPerKm);
}

/** Service advice from a vehicle's condition: below 50 % soon, below the job minimum it must be repaired. */
export const SERVICE_SOON_BELOW = 50;
export function serviceState(condition: number): 'ok' | 'soon' | 'required' {
  if (condition < ECONOMY.minConditionForJobs) return 'required';
  if (condition < SERVICE_SOON_BELOW) return 'soon';
  return 'ok';
}
