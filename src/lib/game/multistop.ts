/**
 * Groupage loads (сборни товари): one trip with one or two drops on the way
 * before the final destination. Each drop has its own delivery window; a late
 * drop costs a penalty on its share of the load. The extra stops pay better.
 */
import { contractWindowMinutes } from './schedule';

export const MULTISTOP = {
  /** Share of new market loads that are groupage (where a city on the way fits). */
  share: 0.15,
  /** Only loads of at least this distance get stops. */
  minKm: 250,
  maxStops: 2,
  /** Extra pay per stop, on the reward of the whole trip. */
  stopBonusShare: 0.12,
  /** A stop may lengthen the trip by at most this much (straight-line estimate). */
  maxDetour: 1.2,
  /** A stop is at least this far from the previous point and from the destination (km, straight line). */
  minLegKm: 40,
  /** Unloading part of the load at a stop (real minutes, compressed like the rest of the trip). */
  unloadMin: 30,
  /** Penalty for a late drop, on that drop's share of the reward. */
  latePenaltyShare: 0.3,
} as const;

export interface ContractStop {
  cityId: number;
  /** Position along the loaded route (km from the origin). */
  km: number;
  /** Tonnes unloaded here. */
  tons: number;
  /** Delivery window of this drop, counted from acceptance (game minutes, like the contract's). */
  windowMinutes: number;
}

/** Reward multiplier of a load with this many stops. */
export const stopMultiplier = (stops: number) => 1 + MULTISTOP.stopBonusShare * stops;

/** Window of a drop at `km` along the route: the normal window for that distance. */
export const stopWindowMinutes = (km: number) => contractWindowMinutes(km);

/** Splits the load between the stops and the destination (each drop 25–40 %, the rest to the end). */
export function splitTons(total: number, stops: number, random: () => number): number[] {
  const parts: number[] = [];
  let left = total;
  for (let i = 0; i < stops; i++) {
    const t = Math.max(0.1, Math.round(total * (0.25 + random() * 0.15) * 10) / 10);
    parts.push(t);
    left -= t;
  }
  return [...parts, Math.max(0.1, Math.round(left * 10) / 10)];
}

/** Penalty for the late drops (each on its share of the reward). */
export function stopPenaltyCents(rewardCents: number, totalTons: number, late: { tons: number }[]): number {
  if (totalTons <= 0) return 0;
  return late.reduce((sum, s) => sum + Math.round(rewardCents * (s.tons / totalTons) * MULTISTOP.latePenaltyShare), 0);
}
