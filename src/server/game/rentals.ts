/**
 * The starter rental. New players get a rented truck; renting more is no longer
 * offered. The rented truck goes back to the lessor when the player buys a truck
 * of their own (right away, or after its current trip), and after a few
 * deliveries the player may buy it out at a lower price.
 */
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { POWER_UNITS, powerUnitModel, RENTAL_BUYOUT_DELIVERIES, rentalBuyoutCents } from '@/lib/game/catalog';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { deliveries, drivers, jobState, trailers, users, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { logActivity, notify } from './notify';
import { uniquePlate } from './names';
import { t, intlLocale } from '@/i18n/t';

type Vehicle = typeof vehicles.$inferSelect;

// ── Test drive (v1.5) ─────────────────────────────────────────────────────

/** A test drive not used within this time goes back to the dealer. */
export const TEST_DRIVE = { hours: 24 } as const;

/** The test truck goes back; the owner-driver sits again in the vehicle they came from (if it is free). */
async function endTestDrive(tx: Tx, v: Vehicle, now: Date) {
  const [owner] = await tx.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.vehicleId, v.id), eq(drivers.isOwner, true)));
  // The player's own trailer stays where the truck stopped, uncoupled.
  await tx.update(trailers).set({ vehicleId: null }).where(and(eq(trailers.vehicleId, v.id), ne(trailers.ownership, 'rented')));
  await releaseRental(tx, v, now);
  if (owner && v.testDriveFrom) {
    const [from] = await tx.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.id, v.testDriveFrom), isNull(vehicles.soldAt), sql`not exists (select 1 from drivers d where d.vehicle_id = ${vehicles}.id)`));
    if (from) await tx.update(drivers).set({ vehicleId: from.id }).where(eq(drivers.id, owner.id));
  }
}

/**
 * One trip with a truck from the dealer's range before buying it: the
 * player's own driver takes it in the city where they stand; no rental fee,
 * once per model. After the trip (or after a day unused) it goes back.
 */
export async function startTestDrive(db: Database, userId: string, modelId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'test_drive', now))) fail('not_released', t('Това идва със следващото обновление.'), 403);
  const model = POWER_UNITS.find((m) => m.id === modelId);
  if (!model) fail('unknown_model', t('Непознат модел.'));
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [u] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
    if ((u?.level ?? 1) < model!.minLevel) fail('level', t('Моделът е от ниво {0}.', model!.minLevel));
    const [active] = await tx.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.companyId, company.id), isNotNull(vehicles.testDriveFrom), isNull(vehicles.soldAt)));
    if (active) fail('active', t('Вече имаш камион на тест-драйв.'));
    const [owner] = await tx.select().from(drivers).where(and(eq(drivers.companyId, company.id), eq(drivers.isOwner, true))).for('update');
    if (!owner?.vehicleId) fail('no_vehicle', t('Седни в свой камион, за да отидеш на тест-драйв.'));
    const [from] = await tx.select().from(vehicles).where(eq(vehicles.id, owner!.vehicleId!));
    if (from!.status !== 'idle' || (from!.movingUntil && from!.movingUntil > now)) fail('vehicle_busy', t('Камионът ти е на път — изчакай да пристигне.'));
    const [first] = await tx.insert(jobState).values({ key: `test-drive:${userId}:${model!.id}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning({ key: jobState.key });
    if (!first) fail('already', t('Вече си карал този модел на тест-драйв.'));
    const [truck] = await tx.insert(vehicles).values({ companyId: company.id, modelId: model!.id, plate: await uniquePlate(tx), color: '#f8fafc', cityId: from!.cityId, ownership: 'rented', purchasePriceCents: 0, testDriveFrom: from!.id }).returning();
    await tx.update(drivers).set({ vehicleId: truck!.id }).where(eq(drivers.id, owner!.id));
    await logActivity(tx, userId, 'test_drive', { modelId: model!.id, vehicleId: truck!.id });
    return { vehicleId: truck!.id, cityId: from!.cityId };
  });
}

/** Worker: test trucks unused for a day go back to the dealer. */
export async function expireTestDrives(db: Database, now = new Date()) {
  const due = await db.select().from(vehicles).where(and(isNotNull(vehicles.testDriveFrom), isNull(vehicles.soldAt), eq(vehicles.status, 'idle'), sql`${vehicles.purchasedAt} < ${new Date(now.getTime() - TEST_DRIVE.hours * 3_600_000)}`));
  for (const v of due) await db.transaction((tx) => endTestDrive(tx, v, now));
  return due.length;
}

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
    .where(and(eq(vehicles.companyId, companyId), eq(vehicles.ownership, 'owned'), isNull(vehicles.soldAt), sql`not exists (select 1 from drivers d where d.vehicle_id = ${vehicles}.id)`))
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
    .where(and(eq(vehicles.companyId, companyId), eq(vehicles.ownership, 'rented'), isNull(vehicles.soldAt), eq(vehicles.returnPending, false), isNull(vehicles.testDriveFrom)))
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
  if (v.testDriveFrom) {
    await endTestDrive(tx, v, now);
    const model = powerUnitModel(v.modelId);
    await notify(tx, ownerUserId, 'success', () => t('Тест-драйвът свърши'), () => t('{0} {1} се върна в салона. Хареса ли ти? Купи го от Автопарк → Нов камион.', model.brand, model.name), '/game/fleet');
    return;
  }
  if (v.returnPending) {
    const [owner] = await tx.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.vehicleId, v.id), eq(drivers.isOwner, true)));
    await releaseRental(tx, v, now);
    if (owner) await seatOwner(tx, v.companyId, owner.id);
    await notify(tx, ownerUserId, 'info', () => t('Наетият камион е върнат'), () => t('{0} пристигна и беше върнат на наемодателя — вече караш собствен камион.', v.plate), '/game/fleet');
    return;
  }
  if ((await deliveriesWith(tx, v.id)) === RENTAL_BUYOUT_DELIVERIES) {
    const price = rentalBuyoutCents(v.modelId);
    await notify(tx, ownerUserId, 'success', () => t('Можеш да откупиш наетия камион'), () => t('След {0} доставки наемодателят ти предлага {1} ({2}) за {3} лв. — наполовина от цената на нов.', RENTAL_BUYOUT_DELIVERIES, powerUnitModel(v.modelId).name, v.plate, (price / 100).toLocaleString(intlLocale())), '/game/fleet');
  }
}

/** Buys out the rented truck at the reduced price; from then on it is the player's own. */
export async function buyoutRental(db: Database, userId: string, vehicleId: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id), isNull(vehicles.soldAt))).for('update');
    if (!v) fail('vehicle_not_found', t('Превозното средство не е намерено.'), 404);
    if (v!.ownership !== 'rented') fail('not_rented', t('Това превозно средство вече е твое.'));
    if (v!.testDriveFrom) fail('test_drive', t('Камионът за тест-драйв не се откупува — купи нов от салона.'));
    if (v!.returnPending) fail('return_pending', t('Този камион ще бъде върнат след курса — вече имаш собствен.'));
    const done = await deliveriesWith(tx, v!.id);
    if (done < RENTAL_BUYOUT_DELIVERIES) fail('too_early', t('Откупуването е възможно след {0} доставки с камиона (имаш {1}).', RENTAL_BUYOUT_DELIVERIES, done));
    const [trailer] = await tx.select().from(trailers).where(and(eq(trailers.vehicleId, v!.id), eq(trailers.ownership, 'rented'), isNull(trailers.soldAt)));
    const price = rentalBuyoutCents(v!.modelId, trailer?.modelId);
    await post(tx, company.id, [{ category: 'vehicle_purchase', amountCents: -price, description: t('Откупуване на {0} ({1})', powerUnitModel(v!.modelId).name, v!.plate), idempotencyKey: `buyout:${v!.id}`, refType: 'vehicle', refId: v!.id }], { requireFunds: true });
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
    if (!v || v.soldAt) fail('vehicle_not_found', t('Превозното средство не е намерено.'), 404);
    if (v!.ownership !== 'rented') fail('not_rented', t('Това превозно средство е собствено.'));
    if (v!.status !== 'idle') fail('vehicle_busy', t('Не можете да върнете камиона по време на курс.'));
    const active = await tx.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.companyId, company.id), isNull(vehicles.soldAt), ne(vehicles.ownership, 'company')));
    if (active.length <= 1) fail('last_vehicle', t('Без камион не можете да работите. Първо купете собствен.'));
    const [owner] = await tx.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.vehicleId, v!.id), eq(drivers.isOwner, true)));
    await releaseRental(tx, v!);
    if (owner) await seatOwner(tx, company.id, owner.id);
    await logActivity(tx, userId, 'rental_returned', { vehicleId });
  });
}
