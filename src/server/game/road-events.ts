import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';
import { ROAD_EVENTS, applyDueEvents, type RoadEventPlan } from '@/lib/game/road-events';
import { scheduleEnd, type Segment } from '@/lib/game/schedule';
import type { Database, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries } from '@/server/db/schema';
import { post } from './finance';
import { broadcast, notify } from './notify';

type DeliveryRow = typeof deliveries.$inferSelect;

/**
 * Applies the road events of one (locked) delivery that are due by `now`:
 * adds the stop to the schedule, moves the arrival, charges a repair and tells
 * the player. Returns the new arrival time (epoch ms).
 */
export async function applyRoadEvents(tx: Tx, d: DeliveryRow, now: Date): Promise<number> {
  const result = applyDueEvents(d.schedule as Segment[], d.roadEvents as RoadEventPlan[], now.getTime());
  const eta = scheduleEnd(result.schedule);
  if (!result.applied.length) return d.etaAt.getTime();
  await tx
    .update(deliveries)
    .set({ schedule: result.schedule, roadEvents: result.events, nextEventAt: result.nextAt ? new Date(result.nextAt) : null, etaAt: new Date(eta) })
    .where(eq(deliveries.id, d.id));
  const [company] = await tx.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, d.companyId));
  const [contract] = await tx.select({ destCityId: contracts.destCityId }).from(contracts).where(eq(contracts.id, d.contractId));
  const [dest] = contract ? await tx.select({ nameBg: cities.nameBg }).from(cities).where(eq(cities.id, contract.destCityId)) : [];
  const index = (e: RoadEventPlan) => (d.roadEvents as RoadEventPlan[]).findIndex((x) => x.at === e.at && x.kind === e.kind);
  for (const e of result.applied) {
    const def = ROAD_EVENTS[e.kind];
    const minutes = Math.max(1, Math.round(e.delayMs / 60_000));
    if (e.costCents) {
      await post(tx, d.companyId, [{ category: 'road_events', amountCents: -e.costCents, description: `${def.title} — пътна помощ`, idempotencyKey: `delivery:${d.id}:event:${index(e)}`, refType: 'delivery', refId: d.id }]);
    }
    if (company) {
      const cost = e.costCents ? ` Пътна помощ: ${(e.costCents / 100).toLocaleString('bg-BG')} €.` : '';
      await notify(tx, company.ownerId, 'warning', `${def.title} по пътя${dest ? ` за ${dest.nameBg}` : ''}`, `${def.body} Закъснение около ${minutes} мин.${cost}`, '/game/fleet');
    }
  }
  return eta;
}

/** Worker: applies every road event that is due. Safe to run concurrently (row locks). */
export async function applyDueRoadEvents(db: Database, now = new Date()): Promise<number> {
  const due = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(eq(deliveries.status, 'in_progress'), isNotNull(deliveries.nextEventAt), lte(deliveries.nextEventAt, now)))
    .orderBy(asc(deliveries.nextEventAt))
    .limit(200);
  let applied = 0;
  for (const { id } of due) {
    const changed = await db.transaction(async (tx) => {
      const [d] = await tx.select().from(deliveries).where(and(eq(deliveries.id, id), eq(deliveries.status, 'in_progress'))).for('update', { skipLocked: true });
      if (!d || !d.nextEventAt || d.nextEventAt > now) return false;
      await applyRoadEvents(tx, d, now);
      return true;
    });
    if (changed) applied++;
  }
  if (applied) await broadcast(db, 'world');
  return applied;
}
