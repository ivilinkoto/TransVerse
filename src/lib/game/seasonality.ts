import type { CargoType } from './cargo';

/** Monthly demand multipliers (Jan..Dec) per cargo — game balance, inspired by real seasonal patterns. */
export const SEASONALITY: Record<CargoType, number[]> = {
  pallets: [0.9, 0.9, 0.95, 1, 1, 1, 0.95, 0.95, 1.05, 1.1, 1.25, 1.35],
  refrigerated: [0.9, 0.9, 0.95, 1, 1.05, 1.2, 1.35, 1.35, 1.1, 1, 0.95, 1.1],
  bulk: [0.75, 0.75, 0.85, 0.95, 1, 1.1, 1.4, 1.45, 1.3, 1.05, 0.9, 0.8],
  container: [1, 1, 1, 1, 1, 1, 1.05, 1.05, 1.05, 1.1, 1.1, 1],
  liquid: [1.3, 1.25, 1.1, 0.95, 0.9, 0.95, 1.05, 1.05, 0.95, 1, 1.15, 1.3],
  special: [0.7, 0.75, 0.95, 1.1, 1.2, 1.2, 1.15, 1.1, 1.1, 1, 0.85, 0.7],
  steel: [0.8, 0.85, 1, 1.1, 1.15, 1.15, 1.05, 1, 1.1, 1.05, 0.9, 0.8],
  vehicles: [0.85, 0.95, 1.2, 1.15, 1.05, 1, 0.9, 0.85, 1.1, 1.05, 1, 0.9],
};

export function seasonalFactor(cargo: CargoType, date: Date): number {
  return SEASONALITY[cargo][date.getUTCMonth()] ?? 1;
}
