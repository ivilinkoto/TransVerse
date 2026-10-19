import { and, eq, like, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { ECO } from '@/lib/game/eco';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, notifications, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { ecoBoard, ecoWeek, settleEcoWeek } from '@/server/game/eco';
import { post } from '@/server/game/finance';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

// A week far ahead so other tests' trips do not count.
const TUESDAY = new Date('2031-06-10T08:00:00Z');

async function ownTrip(extraCostCents = 0) {
  const p = await newPlayer('Sofia');
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
  const [v] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, acc!.id), sql`${vehicles.soldAt} is null`));
  await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, v!.id));
  const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv', { expiresAt: new Date('2032-01-01T00:00:00Z') })).id, v!.id, TUESDAY);
  await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc!.id);
  if (extraCostCents) await db().transaction((tx) => post(tx, acc!.id, [{ category: 'road_events', amountCents: -extraCostCents, description: 'пътна помощ', idempotencyKey: `test:${d.id}`, refType: 'delivery', refId: d.id }]));
  return p;
}

describe('economical driver', () => {
  it('ranks by cost per km and pays the top three once', async () => {
    const thrifty = await ownTrip();
    const costly = await ownTrip(50_000_00);
    const week = ecoWeek(TUESDAY);
    const board = await ecoBoard(db(), week, 0);
    const order = board.map((r) => r.userId).filter((id) => id === thrifty.userId || id === costly.userId);
    expect(order).toEqual([thrifty.userId, costly.userId]);
    expect(board.find((r) => r.userId === costly.userId)!.costCents).toBeGreaterThan(50_000_00);
    // The real ranking needs the minimum distance: one short trip is not enough.
    expect((await ecoBoard(db(), week)).some((r) => r.userId === thrifty.userId)).toBe(false);

    // The week after: the top three are paid once.
    const next = new Date(TUESDAY.getTime() + 7 * 86_400_000);
    expect(await settleEcoWeek(db(), next, 0)).toBe(2);
    expect(await settleEcoWeek(db(), next, 0)).toBe(0);
    const coins = await db().select().from(coinEntries).where(like(coinEntries.idempotencyKey, `eco:${week.key}:%`));
    expect(coins.find((c) => c.userId === thrifty.userId)!.amount).toBe(ECO.prizes[0]!.coins);
    expect(coins.find((c) => c.userId === costly.userId)!.amount).toBe(ECO.prizes[1]!.coins);
    expect(await db().select().from(notifications).where(and(eq(notifications.userId, thrifty.userId), like(notifications.title, 'Икономичен шофьор: 1.%')))).toHaveLength(1);
  });
});
