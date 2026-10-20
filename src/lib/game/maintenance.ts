/**
 * Maintenance (v1.3): a truck should be serviced every so many kilometres.
 * Overdue, it breaks down and gets into trouble on the road more often; just
 * serviced, a little less. Rented trucks are the landlord's business.
 */
export const MAINTENANCE = {
  intervalKm: 6000,
  /** Right after a service the truck is in its best shape for this many km. */
  freshKm: 1500,
  /** Road events chance multipliers. */
  overdueFactor: 1.5,
  freshFactor: 0.8,
  /** A service costs this share of the truck's price (the company's service and VIP make it cheaper). */
  costShare: 0.004,
  minCostCents: 300_00,
} as const;

export interface MaintenanceState {
  sinceKm: number;
  /** Kilometres left until it is due (negative when overdue). */
  dueInKm: number;
  overdue: boolean;
  fresh: boolean;
  /** Multiplier on the chance of road events. */
  factor: number;
}

export function maintenanceState(odometerKm: number, serviceKm: number): MaintenanceState {
  const sinceKm = Math.max(0, odometerKm - serviceKm);
  const dueInKm = MAINTENANCE.intervalKm - sinceKm;
  const overdue = dueInKm < 0;
  const fresh = sinceKm <= MAINTENANCE.freshKm;
  return { sinceKm, dueInKm, overdue, fresh, factor: overdue ? MAINTENANCE.overdueFactor : fresh ? MAINTENANCE.freshFactor : 1 };
}

export const maintenanceCostCents = (vehiclePriceCents: number, discount = 0) => Math.max(MAINTENANCE.minCostCents, Math.round(vehiclePriceCents * MAINTENANCE.costShare * (1 - discount)));
