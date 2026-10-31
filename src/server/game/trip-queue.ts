import { and, asc, count, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, contracts, tripQueue, vehicles } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { acceptContract } from './deliveries';
import { fail, GameError } from './errors';
import { notify } from './notify';
import { officeEffects } from './office';
import { featureFor } from '@/server/features';

/**
 * 1.1.4.1 „Планирай следващия курс“: up to three loads lined up for a truck on
 * the road. When it is free the worker starts the first one that is still
 * open; nothing is held for the player, so a load someone else took is skipped.
 */
export const QUEUE_SIZE = 3;

export async function queueTrip(db: Database, userId: string, vehicleId: string, contractId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [v] = await tx.select({ id: vehicles.id, status: vehicles.status, soldAt: vehicles.soldAt }).from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id)));
    if (!v || v.soldAt) fail('vehicle_not_found', t('Превозното средство не е намерено.'), 404);
    if (v!.status === 'idle') fail('vehicle_free', t('Камионът е свободен — вземи поръчката направо.'));
    const [c] = await tx.select({ status: contracts.status, expiresAt: contracts.expiresAt }).from(contracts).where(eq(contracts.id, contractId));
    if (!c || c.status !== 'open' || c.expiresAt <= now) fail('contract_unavailable', t('Поръчката вече не е налична.'), 409);
    const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(tripQueue).where(eq(tripQueue.vehicleId, vehicleId));
    // 1.1.4.2: a dispatcher in the office adds a place per level.
    const size = QUEUE_SIZE + ((await featureFor(tx, userId, 'office', now)) ? (await officeEffects(tx, company.id)).dispatcher : 0);
    if (n >= size) fail('queue_full', t('Най-много {0} курса напред за камион.', size));
    const [row] = await tx.insert(tripQueue).values({ companyId: company.id, vehicleId, contractId, userId, position: n }).onConflictDoNothing().returning({ id: tripQueue.id });
    if (!row) fail('already_queued', t('Този товар вече е в опашката на камиона.'));
    return { position: n + 1 };
  });
}

/** 1.1.4.2: move a queued trip one place up or down (within its truck's queue). */
export async function moveQueued(db: Database, userId: string, id: string, dir: 'up' | 'down') {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [item] = await tx.select({ vehicleId: tripQueue.vehicleId }).from(tripQueue).where(and(eq(tripQueue.id, id), eq(tripQueue.companyId, company.id)));
    if (!item) fail('not_queued', t('Курсът вече не е в опашката.'), 404);
    const list = await tx.select({ id: tripQueue.id }).from(tripQueue).where(eq(tripQueue.vehicleId, item!.vehicleId)).orderBy(asc(tripQueue.position), asc(tripQueue.createdAt)).for('update');
    const i = list.findIndex((x) => x.id === id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return { moved: false };
    [list[i], list[j]] = [list[j]!, list[i]!];
    for (const [pos, x] of list.entries()) await tx.update(tripQueue).set({ position: pos }).where(eq(tripQueue.id, x.id));
    return { moved: true };
  });
}

export async function unqueueTrip(db: DbOrTx, userId: string, id: string) {
  const company = await companyForUser(db, userId);
  await db.delete(tripQueue).where(and(eq(tripQueue.id, id), eq(tripQueue.companyId, company.id)));
}

/** The trucks' lined-up trips, in order (for the fleet and the dashboard). */
export async function queuedTrips(db: DbOrTx, companyId: string) {
  const origin = alias(cities, 'origin');
  const dest = alias(cities, 'dest');
  return db
    .select({ id: tripQueue.id, vehicleId: tripQueue.vehicleId, goods: contracts.goods, from: origin.nameBg, to: dest.nameBg, rewardCents: contracts.rewardCents, open: eq(contracts.status, 'open') })
    .from(tripQueue)
    .innerJoin(contracts, eq(contracts.id, tripQueue.contractId))
    .innerJoin(origin, eq(origin.id, contracts.originCityId))
    .innerJoin(dest, eq(dest.id, contracts.destCityId))
    .where(eq(tripQueue.companyId, companyId))
    .orderBy(asc(tripQueue.position), asc(tripQueue.createdAt));
}

/** Worker (every minute): a free truck with a queue starts its next trip. Returns how many started. */
export async function runTripQueues(db: Database, now = new Date()) {
  const waiting = await db
    .select({ id: tripQueue.id, vehicleId: tripQueue.vehicleId, contractId: tripQueue.contractId, userId: tripQueue.userId, plate: vehicles.plate })
    .from(tripQueue)
    .innerJoin(vehicles, eq(vehicles.id, tripQueue.vehicleId))
    .where(and(eq(vehicles.status, 'idle'), or(isNull(vehicles.movingUntil), lte(vehicles.movingUntil, now))))
    .orderBy(asc(tripQueue.position), asc(tripQueue.createdAt));
  const byTruck = new Map<string, typeof waiting>();
  for (const w of waiting) byTruck.set(w.vehicleId, [...(byTruck.get(w.vehicleId) ?? []), w]);
  let started = 0;
  for (const [, list] of byTruck) {
    const head = list[0]!;
    let done = false;
    const tried: string[] = [];
    for (const item of list) {
      tried.push(item.id);
      try {
        await acceptContract(db, item.userId, item.contractId, item.vehicleId, now);
        done = true;
        break;
      } catch (error) {
        // Taken, expired or no longer doable: try the next one.
        if (!(error instanceof GameError)) throw error;
      }
    }
    await db.delete(tripQueue).where(inArray(tripQueue.id, tried));
    if (done) {
      started++;
      await notify(db, head.userId, 'success', () => t('▶ {0} тръгна на следващия курс', head.plate), () => t('Курсът от опашката започна сам.'), '/game/fleet');
    } else {
      await notify(db, head.userId, 'warning', () => t('{0} чака нов курс', head.plate), () => t('Товарите от опашката вече ги няма — избери нов.'), '/game/contracts');
    }
  }
  return started;
}
