import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { hurrySchedule, speedUpPrice, SPEED_UP } from '@/lib/game/speed-up';
import type { Segment } from '@/lib/game/schedule';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, deliveries, ledgerEntries, users, vehicles } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyShopItem } from '@/server/game/shop';
import { speedUpDelivery } from '@/server/game/speed-up';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;
async function trip() {
  const p = await newPlayer();
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
  await db().transaction((tx) => postCoins(tx, p.userId, { amount: 1_000, reason: 'purchase', description: 'test', idempotencyKey: `speed-coins:${p.userId}` }));
  const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, truck!.id);
  return { p, acc: acc!, d };
}

describe('1.3.2.2: hurrying a trip with ТрансКоин', () => {
  it('prices by the minutes left; half costs less; VIP pays less', () => {
    expect(speedUpPrice(60 * 60_000, 'finish', false)).toBe(20);
    expect(speedUpPrice(60 * 60_000, 'half', false)).toBe(12);
    expect(speedUpPrice(60 * 60_000, 'finish', true)).toBe(16);
    expect(speedUpPrice(60_000, 'finish', false)).toBe(SPEED_UP.minCoins);
  });

  it('squeezes only what is left of the schedule', () => {
    const s: Segment[] = [
      { kind: 'drive', leg: 'loaded', start: 0, end: 600_000, fromKm: 0, toKm: 10 },
      { kind: 'drive', leg: 'loaded', start: 600_000, end: 1_200_000, fromKm: 10, toKm: 20 },
    ];
    const h = hurrySchedule(s, 300_000, 0.5);
    expect(h[0]!.start).toBe(0);
    expect(h.at(-1)!.end).toBe(300_000 + 450_000);
    expect(hurrySchedule(s, 300_000, 0).at(-1)!.end).toBe(301_000);
  });

  it('„arrive now“ takes the TC and pays the trip at once; half the time moves the arrival', async () => {
    const { p, d } = await trip();
    const now = new Date();
    const before = await coins(p.userId);
    const half = await speedUpDelivery(db(), p.userId, d.id, 'half', now);
    expect(await coins(p.userId)).toBe(before - half.price);
    expect(half.etaAt.getTime()).toBeLessThan(d.etaAt.getTime());
    const done = await speedUpDelivery(db(), p.userId, d.id, 'finish', new Date(now.getTime() + 1_000));
    // The finished trip can pay coin rewards of its own (achievements), so check the charge itself.
    const [charge] = await db().select({ amount: coinEntries.amount }).from(coinEntries).where(and(eq(coinEntries.userId, p.userId), like(coinEntries.idempotencyKey, `speed-up:${d.id}:finish:%`)));
    expect(charge?.amount).toBe(-done.price);
    const [row] = await db().select({ status: deliveries.status }).from(deliveries).where(eq(deliveries.id, d.id));
    expect(row!.status).toBe('completed');
    expect(await code(speedUpDelivery(db(), p.userId, d.id, 'finish', new Date()))).toBe('delivery_not_found');
  });

  it('boosters: +50 % pay outside the bonus cap, and no tolls', async () => {
    const { p, acc, d } = await trip();
    await buyShopItem(db(), p.userId, { item: 'money_boost_24h' });
    await buyShopItem(db(), p.userId, { item: 'toll_free_24h' });
    await speedUpDelivery(db(), p.userId, d.id, 'finish', new Date());
    const rows = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc.id), like(ledgerEntries.idempotencyKey, `delivery:${d.id}:%`)));
    const by = Object.fromEntries(rows.map((r) => [r.category, r.amountCents]));
    expect(by.booster).toBe(Math.round(by.freight! * 0.5));
    expect(by.tolls).toBeUndefined();
  });
});
