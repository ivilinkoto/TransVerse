import { CARGO, type CargoType } from './cargo';
import { rewardCents } from './economy';

/**
 * Long-term contracts with client companies (fictional names, game data):
 * several loads on one lane before a deadline. Each load pays a little more
 * than the open market; finishing all loads pays a bonus and reputation,
 * failing costs reputation.
 */
export const CLIENT_RULES = {
  /** Offers shown at a time; they are renewed when they run out (every offerHours at most). */
  offers: 3,
  offerHours: 24,
  maxActive: 2,
  vipExtraActive: 1,
  loads: [3, 8] as [number, number],
  km: [120, 900] as [number, number],
  /** Origin within this distance of one of the player's vehicles or the HQ. */
  originRadiusKm: 250,
  rewardMultiplier: 1.12,
  bonusShare: 0.25,
  /** Hours to finish: a base plus per load. */
  baseHours: 24,
  hoursPerLoad: 6,
  successReputation: 4,
  failReputation: 4,
  failReputationPerMissingLoad: 1,
} as const;

/** Reputation a contract needs, by its size. */
export function clientMinReputation(loads: number): number {
  return loads >= 7 ? 40 : loads >= 5 ? 20 : 0;
}

export function clientDurationHours(loads: number): number {
  return CLIENT_RULES.baseHours + loads * CLIENT_RULES.hoursPerLoad;
}

export function clientTerms(cargo: CargoType, tons: number, km: number, loads: number) {
  const perLoad = rewardCents(cargo, tons, km, CLIENT_RULES.rewardMultiplier);
  return {
    rewardPerLoadCents: perLoad,
    bonusCents: Math.round((perLoad * loads * CLIENT_RULES.bonusShare) / 100) * 100,
    minReputation: clientMinReputation(loads),
    durationHours: clientDurationHours(loads),
    minLevel: CARGO[cargo].minLevel,
  };
}

/** Bonus actually paid: late loads take their share off it. */
export function clientBonusCents(bonusCents: number, loadsTotal: number, loadsLate: number): number {
  if (loadsTotal <= 0) return 0;
  return Math.round((bonusCents * Math.max(0, loadsTotal - loadsLate)) / loadsTotal);
}

export function clientFailReputation(loadsTotal: number, loadsDone: number): number {
  return CLIENT_RULES.failReputation + CLIENT_RULES.failReputationPerMissingLoad * Math.max(0, loadsTotal - loadsDone);
}
