import { and, asc, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { contracts, laneRepeats, tripQueue, vehicles } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { companyForUser } from './company';
import { acceptContract } from './deliveries';
import { fail, GameError } from './errors';

/**
 * 1.1.4.2 „Повтаряй линията“: a free truck takes the best open load from where
 * it stands to the other end of its lane (or towards the lane), until stopped.
 * The trip queue goes first.
 */
export async function setLaneRepeat(db: DbOrTx, userId: string, vehicleId: string, lane: { a: number; b: number } | null) {
  const company = await companyForUser(db, userId);
  const [v] = await db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, company.id), isNull(vehicles.soldAt)));
  if (!v) fail('vehicle_not_found', t('Превозното средство не е намерено.'), 404);
  if (!lane) {
    await db.delete(laneRepeats).where(eq(laneRepeats.vehicleId, vehicleId));
    return null;
  }
  if (lane.a === lane.b) fail('same_city', t('Изберете два различни града.'));
  await db.insert(laneRepeats).values({ vehicleId, companyId: company.id, userId, aCityId: lane.a, bCityId: lane.b }).onConflictDoUpdate({ target: laneRepeats.vehicleId, set: { aCityId: lane.a, bCityId: lane.b, userId } });
  return lane;
}

export async function laneRepeatsOf(db: DbOrTx, companyId: string) {
  return db.select().from(laneRepeats).where(eq(laneRepeats.companyId, companyId));
}

/** Worker: free trucks on a lane take their next load. Returns how many started. */
export async function runLaneRepeats(db: Database, now = new Date()) {
  const free = await db
    .select({ vehicleId: laneRepeats.vehicleId, userId: laneRepeats.userId, a: laneRepeats.aCityId, b: laneRepeats.bCityId, cityId: vehicles.cityId })
    .from(laneRepeats)
    .innerJoin(vehicles, eq(vehicles.id, laneRepeats.vehicleId))
    .where(and(eq(vehicles.status, 'idle'), or(isNull(vehicles.movingUntil), lte(vehicles.movingUntil, now)), sql`not exists (select 1 from ${tripQueue} where ${tripQueue.vehicleId} = ${laneRepeats.vehicleId})`));
  let started = 0;
  for (const f of free) {
    const target = f.cityId === f.a ? f.b : f.cityId === f.b ? f.a : f.a;
    const loads = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.status, 'open'), gt(contracts.expiresAt, now), eq(contracts.originCityId, f.cityId ?? -1), eq(contracts.destCityId, target), or(isNull(contracts.reservedByCompanyId), lte(contracts.reservedUntil, now))))
      .orderBy(desc(contracts.rewardCents), asc(contracts.createdAt))
      .limit(5);
    for (const l of loads) {
      try {
        await acceptContract(db, f.userId, l.id, f.vehicleId, now);
        await db.update(laneRepeats).set({ trips: sql`${laneRepeats.trips} + 1` }).where(eq(laneRepeats.vehicleId, f.vehicleId));
        started++;
        break;
      } catch (error) {
        if (!(error instanceof GameError)) throw error;
      }
    }
  }
  return started;
}

/** The last loaded lane of each truck (to offer „Повтаряй“). */
export async function lastLanesOf(db: DbOrTx, companyId: string) {
  const rows = await db.execute<{ vehicle_id: string; a: number; b: number; from_name: string; to_name: string }>(sql`
    select distinct on (d.vehicle_id) d.vehicle_id, c.origin_city_id as a, c.dest_city_id as b, o.name_bg as from_name, t.name_bg as to_name
    from deliveries d
    join contracts c on c.id = d.contract_id
    join cities o on o.id = c.origin_city_id
    join cities t on t.id = c.dest_city_id
    where d.company_id = ${companyId} and d.status = 'completed'
    order by d.vehicle_id, d.completed_at desc`);
  return new Map(rows.rows.map((r) => [r.vehicle_id, { a: Number(r.a), b: Number(r.b), from: r.from_name, to: r.to_name }]));
}
