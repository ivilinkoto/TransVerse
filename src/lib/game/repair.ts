/**
 * 1.2.3.1: partial repairs in the garage (feature `partial_repair`). The player
 * picks what to repair (the truck, the trailer or both) and how much of the
 * damage — a share of it or as much as the money allows. Pure rules shared by
 * the server and the garage page; the server always decides the price.
 */
import { ECONOMY } from './economy';

export type RepairPart = 'all' | 'truck' | 'trailer';
/** The shares of the damage the garage offers (percent). */
export const REPAIR_SHARES = [25, 50, 75, 100] as const;

export interface RepairUnit { priceCents: number; condition: number }
export interface RepairPlan {
  /** Condition after the repair (null: no trailer). */
  truckTo: number;
  trailerTo: number | null;
  /** Repaired points on each unit. */
  truckPoints: number;
  trailerPoints: number;
  costCents: number;
}

/** Repair cost of `points` condition points of a unit (the same rate as a full repair). */
const unitCents = (u: RepairUnit, points: number) => Math.round((points * u.priceCents * ECONOMY.repairCentsPerPointPerThousandValue) / 1000);
const missing = (u: RepairUnit) => Math.max(0, 100 - u.condition);
/** Rounds down to 0.1 of a point. */
const tenth = (x: number) => Math.floor(x * 10 + 1e-9) / 10;

/**
 * What a repair does and costs. `factor` is the price after discounts (1 = no discount);
 * with `budgetCents` the repair shrinks to what that money pays for.
 */
export function repairPlan(truck: RepairUnit, trailer: RepairUnit | null, part: RepairPart, share: number, factor: number, budgetCents?: number): RepairPlan {
  const s = Math.min(100, Math.max(0, share)) / 100;
  let tp = part === 'trailer' ? 0 : missing(truck) * s;
  let rp = trailer && part !== 'truck' ? missing(trailer) * s : 0;
  // A full share keeps the exact points (and the price of the old one-button repair).
  if (s < 1) { tp = tenth(tp); rp = tenth(rp); }
  const cost = (a: number, b: number) => Math.round((unitCents(truck, a) + (trailer ? unitCents(trailer, b) : 0)) * factor);
  let c = cost(tp, rp);
  if (budgetCents !== undefined && c > budgetCents) {
    const scale = Math.max(0, budgetCents) / c;
    tp = tenth(tp * scale);
    rp = tenth(rp * scale);
    c = cost(tp, rp);
    // Rounding to whole cents can still go a cent over: take a tenth of a point off.
    while (c > budgetCents && tp + rp > 0) {
      if (tp >= rp) tp = tenth(tp - 0.1); else rp = tenth(rp - 0.1);
      c = cost(tp, rp);
    }
  }
  return {
    truckTo: tp >= missing(truck) - 1e-9 ? Math.max(100, truck.condition) : truck.condition + tp,
    trailerTo: trailer ? (rp >= missing(trailer) - 1e-9 ? Math.max(100, trailer.condition) : trailer.condition + rp) : null,
    truckPoints: tp,
    trailerPoints: rp,
    costCents: c,
  };
}
