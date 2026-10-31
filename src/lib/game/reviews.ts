import { hash } from './missions';

/**
 * 1.1.4.2 „Отзиви от клиента“ and „Тайният клиент“. On arrival the client
 * gives 1–5 stars; the company's average opens better clients. Once a week
 * one trip is secretly checked — a perfect one earns ТрансКоин and a badge.
 * Game data.
 */
export const REVIEWS = {
  /** The average (of at least `minTrips` reviews) for the better clients. */
  goodAverage: 4.5,
  minTrips: 10,
  /** Their loads pay this much more. */
  goodClientShare: 0.03,
};

export const MYSTERY = {
  /** The chance that a trip is the week's checked one (until one is). */
  chance: 0.15,
  coins: 15,
  badge: 'mystery-client',
};

export function starsFor(trip: { late: boolean; violations: number; promiseBroken: boolean; condition: number; puzzleFill?: number | null }): number {
  let stars = 5;
  if (trip.late) stars -= 2;
  stars -= Math.min(2, trip.violations);
  if (trip.promiseBroken) stars -= 1;
  // A worn-out truck arrives scruffy.
  if (trip.condition < 40) stars -= 1;
  // A neatly packed trailer is noticed.
  if (stars < 5 && (trip.puzzleFill ?? 0) >= 0.9) stars += 1;
  return Math.max(1, Math.min(5, stars));
}

/** Whether this trip is checked by the mystery client (when the week has none yet). */
export const mysteryPick = (deliveryId: string) => (hash(`mystery:${deliveryId}`) % 1000) / 1000 < MYSTERY.chance;

export const starLine = (stars: number) => '★'.repeat(stars) + '☆'.repeat(5 - stars);
