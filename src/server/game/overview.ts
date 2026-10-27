import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { cities, contracts, deliveries, depots, vehicles } from '@/server/db/schema';
import { openContracts } from './contracts';
import { fleetCapacity } from './fleet';
import { POWER_UNITS } from '@/lib/game/catalog';

/**
 * 1.1.3: the player's last trips on the dashboard, each with an open load on
 * the same lane right now (if there is one) for "Същия курс отново".
 */
export async function recentTrips(db: DbOrTx, companyId: string, userId: string, now: Date, limit = 5) {
  const origin = sql<string>`(select name_bg from cities c where c.id = ${contracts.originCityId})`;
  const rows = await db
    .select({ id: deliveries.id, completedAt: deliveries.completedAt, late: deliveries.late, payoutCents: deliveries.payoutCents, goods: contracts.goods, originId: contracts.originCityId, destId: contracts.destCityId, origin, dest: cities.nameBg })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'completed')))
    .orderBy(desc(deliveries.completedAt))
    .limit(limit);
  // One look at the open loads from each origin (at most `limit`).
  const origins = [...new Set(rows.map((r) => r.originId))];
  const open = new Map<string, string>();
  for (const cityId of origins) {
    for (const c of await openContracts(db, { originCityId: cityId, limit: 100, viewerUserId: userId }, now)) {
      const key = `${c.originCityId}:${c.destCityId}`;
      if (!open.has(key) && !c.urgent) open.set(key, c.id);
    }
  }
  return rows.map((r) => ({ ...r, againId: open.get(`${r.originId}:${r.destId}`) ?? null }));
}

export const FIRST_OWN_TRUCK_AFTER = 5;

/**
 * 1.1.3: a player who still drives only a rented truck after a few deliveries:
 * what buying their own means (where it parks, the places left, what happens to
 * the rental) — instead of a tutorial step.
 */
export async function firstOwnTruck(db: DbOrTx, companyId: string, deliveriesDone: number) {
  if (deliveriesDone < FIRST_OWN_TRUCK_AFTER) return null;
  const fleet = await db
    .select({ id: vehicles.id, plate: vehicles.plate, ownership: vehicles.ownership, status: vehicles.status })
    .from(vehicles)
    .where(and(eq(vehicles.companyId, companyId), isNull(vehicles.soldAt), ne(vehicles.ownership, 'company'), isNull(vehicles.testDriveFrom)));
  if (fleet.length === 0 || fleet.some((v) => v.ownership !== 'rented')) return null;
  const [rental] = fleet;
  const myDepots = await db.select({ name: cities.nameBg }).from(depots).innerJoin(cities, eq(cities.id, depots.cityId)).where(eq(depots.companyId, companyId)).orderBy(asc(depots.createdAt));
  const cap = await fleetCapacity(db, companyId);
  const cheapest = Math.min(...POWER_UNITS.filter((m) => m.minLevel <= 1 && !m.electric).map((m) => m.priceCents));
  return { rental: { plate: rental!.plate, onTrip: rental!.status !== 'idle' }, depots: myDepots.map((d) => d.name), free: cap.slots - cap.used, slots: cap.slots, cheapestCents: cheapest };
}
