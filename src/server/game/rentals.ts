/**
 * The starter rental. New players get a rented truck; renting more is no longer
 * offered. The rented truck goes back to the lessor when the player buys a truck
 * of their own (right away, or after its current trip), and after a few
 * deliveries the player may buy it out at a lower price.
 */
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { powerUnitModel, RENTAL_BUYOUT_DELIVERIES, rentalBuyoutCents } from '@/lib/game/catalog';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { deliveries, drivers, trailers, vehicles } from '@/server/db/schema';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { logActivity, notify } from './notify';

type Vehicle = typeof vehicles.$inferSelect;

/** Completed deliveries made with one vehicle. */
export async function deliveriesWith(db: DbOrTx, vehicleId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(deliveries).where(and(eq(deliveries.vehicleId, vehicleId), eq(deliveries.status, 'completed')));
  return row?.n ?? 0;
}

/** Hands an idle rented truck (and its rented trailer) back. Its driver, if any, becomes free. */
export async function releaseRental(tx: Tx, v: Vehicle, now = new Date()) {
  await tx.update(drivers).set({ vehicleId: null }).where(eq(drivers.vehicleId, v.id));
  await tx.update(drivers).set({ coVehicleId: null }).where(eq(drivers.coVehicleId, v.id));
  await tx.update(trailers).set({ vehicleId: null, soldAt: now }).where(and(eq(trailers.vehicleId, v.id), eq(trailers.ownership, 'rented')));
  await tx.update(vehicles).set({ status: 'returned', soldAt: now, returnPending: false }).where(eq(vehicles.id, v.id));
}

/** The player drives their own truck: the owner-driver moves to it when it has no driver. */
async function seatOwner(tx: Tx, companyId: string, ownerDriverId: string, preferredVehicleId?: string) {
  const candidates = await tx
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.companyId, companyId), eq(vehicles.ownership, 'owned'), isNull(vehicles.soldAt), sql`not exists (select 1 from drivers d where d.vehicle_id = ${vehicles.id})`))
    .orderBy(desc(vehicles.purchasedAt));
  const target = candidates.find((c) => c.id === preferredVehicleId) ?? candidates[0];
  if (target) await tx.update(drivers).set({ vehicleId: target.id }).where(eq(drivers.id, ownerDriverId));
}

/**
 * Called when the player buys a truck: one rented truck goes back (the one they
 * drive themselves first). On a trip it is marked and returned when it arrives.
 */
export async function retireRentalFor(tx: Tx, companyId: string, newVehicleId: string, now = new Date()) {
  const rentals = await tx
    .select({ v: vehicles, owner: drivers.isOwner, driverId: drivers.id })
    .from(vehicles)
    .leftJoin(drivers, eq(drivers.vehicleId, vehicles.id))
    .where(and(eq(vehicles.companyId, companyId), eq(vehicles.ownership, 'rented'), isNull(vehicles.soldAt), eq(vehicles.returnPending, false)))
    .orderBy(desc(sql`coalesce(${drivers.isOwner}, false)`), asc(vehicles.purchasedAt));
  const pick = rentals[0];
  if (!pick) return null;
  if (pick.v.status !== 'idle') {
    await tx.update(vehicles).set({ returnPending: true }).where(eq(vehicles.id, pick.v.id));
    return 'after_trip' as const;
  }
  await releaseRental(tx, pick.v, now);
  if (pick.owner && pick.driverId) await seatOwner(tx, companyId, pick.driverId, newVehicleId);
  return 'returned' as const;
}

/**
 * After a delivery with a rented truck (inside the settlement transaction):
 * return it if the player has bought their own meanwhile, otherwise offer the
 * buy-out once the threshold is reached.
 */
export async function afterRentedTrip(tx: Tx, vehicleId: string, ownerUserId: string, now = new Date()) {
  const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId));
  if (!v || v.ownership !== 'rented' || v.soldAt) return;
  if (v.returnPending) {
    const [owner] = await tx.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.vehicleId, v.id), eq(drivers.isOwner, true)));
    await releaseRental(tx, v, now);
    if (owner) await seatOwner(tx, v.companyId, owner.id);
    await notify(tx, ownerUserId, 'info', 'Наетият камион е върнат', `${v.plate} пристигна и беше върнат на наемодателя — вече караш собствен камион.`, '/game/fleet');
    return;
  }
  if ((await deliveriesWith(tx, v.id)) === RENTAL_BUYOUT_DELIVERIES) {
    const price = rentalBuyoutCents(v.modelId);
    await notify(tx, ownerUserId, 'success', 'Можеш да откупиш наетия камион', `След ${RENTAL_BUYOUT_DELIVERIES} доставки наемодателят ти предлага ${powerUnitModel(v.modelId).name} (${v.plate}) за ${(price / 100).toLocaleString('bg-BG')} лв. — наполовина от цената на нов.`, '/game/fleet');
  }
}

/** Buys out the rented truck at the reduced price; from then on it is the player's own. */
export async function buyoutRental(db: Database, userId: string, vehicleId: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id), isNull(vehicles.soldAt))).for('update');
    if (!v) fail('vehicle_not_found', 'Превозното средство не е намерено.', 404);
    if (v!.ownership !== 'rented') fail('not_rented', 'Това превозно средство вече е твое.');
    if (v!.returnPending) fail('return_pending', 'Този камион ще бъде върнат след курса — вече имаш собствен.');
    const done = await deliveriesWith(tx, v!.id);
    if (done < RENTAL_BUYOUT_DELIVERIES) fail('too_early', `Откупуването е възможно след ${RENTAL_BUYOUT_DELIVERIES} доставки с камиона (имаш ${done}).`);
    const [trailer] = await tx.select().from(trailers).where(and(eq(trailers.vehicleId, v!.id), eq(trailers.ownership, 'rented'), isNull(trailers.soldAt)));
    const price = rentalBuyoutCents(v!.modelId, trailer?.modelId);
    await post(tx, company.id, [{ category: 'vehicle_purchase', amountCents: -price, description: `Откупуване на ${powerUnitModel(v!.modelId).name} (${v!.plate})`, idempotencyKey: `buyout:${v!.id}`, refType: 'vehicle', refId: v!.id }], { requireFunds: true });
    await tx.update(vehicles).set({ ownership: 'owned', purchasePriceCents: price, purchasedAt: new Date() }).where(eq(vehicles.id, v!.id));
    if (trailer) await tx.update(trailers).set({ ownership: 'owned', purchasePriceCents: 0 }).where(eq(trailers.id, trailer.id));
    await logActivity(tx, userId, 'rental_bought_out', { vehicleId: v!.id, priceCents: price });
    return { priceCents: price };
  });
}

/** The player hands back a rented truck themselves (only when they have another one to drive). */
export async function returnRental(db: Database, userId: string, vehicleId: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id))).for('update');
    if (!v || v.soldAt) fail('vehicle_not_found', 'Превозното средство не е намерено.', 404);
    if (v!.ownership !== 'rented') fail('not_rented', 'Това превозно средство е собствено.');
    if (v!.status !== 'idle') fail('vehicle_busy', 'Не можете да върнете камиона по време на курс.');
    const active = await tx.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.companyId, company.id), isNull(vehicles.soldAt)));
    if (active.length <= 1) fail('last_vehicle', 'Без камион не можете да работите. Първо купете собствен.');
    const [owner] = await tx.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.vehicleId, v!.id), eq(drivers.isOwner, true)));
    await releaseRental(tx, v!);
    if (owner) await seatOwner(tx, company.id, owner.id);
    await logActivity(tx, userId, 'rental_returned', { vehicleId });
  });
}
