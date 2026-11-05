import { and, eq, like, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { chargedEmptyKm } from '@/lib/game/economy';
import { isoWeek, MONTH_CARD, offerPrice, patronLevel, VIP_PRICES_V2, weeklyOffers } from '@/lib/game/shop-v2';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, depots, inventoryItems, jobState, payments, users, vehicles } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { buyShopItem, shopPrice } from '@/server/game/shop';
import { claimMonthCard, claimVipCase, monthCardOf } from '@/server/game/shop-v2';
import { refundLocked, settlePaid } from '@/server/payments';
import { cityByName, db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const coinsOf = async (id: string) => (await db().select({ coins: users.coins }).from(users).where(eq(users.id, id)))[0]!.coins;
const qtyOf = async (id: string, item: string) => (await db().select({ qty: inventoryItems.qty }).from(inventoryItems).where(and(eq(inventoryItems.userId, id), eq(inventoryItems.itemId, item))))[0]?.qty ?? 0;
const giveCoins = (id: string, n: number) => db().update(users).set({ coins: sql`${users.coins} + ${n}` }).where(eq(users.id, id));
const makeVip = (id: string) => db().update(users).set({ vipUntil: new Date(Date.now() + 10 * 86_400_000) }).where(eq(users.id, id));

/** A paid order delivered as a provider would confirm it. */
async function pay(userId: string, productId: string, coins: number, vipDays: number, cents: number, now = new Date()) {
  const [p] = await db().insert(payments).values({ userId, provider: 'stripe', productId, coins, vipDays, amountCents: cents, currency: 'eur', consentAt: now }).returning();
  await db().transaction((tx) => settlePaid(tx, p!, { amountCents: cents, currency: 'eur' }, {}, now));
  return (await db().select().from(payments).where(eq(payments.id, p!.id)))[0]!;
}

describe('1.2.3 the empty drive and the shop', () => {
  it('the empty leg to the load costs nothing', () => {
    expect(chargedEmptyKm(3173)).toBe(0);
  });

  it('weekly offers: three different items, the same all week, −25 %; VIP costs more ТрансКоин', () => {
    const mon = new Date('2026-11-02T10:00:00+02:00'), sun = new Date('2026-11-08T20:00:00+02:00');
    expect(isoWeek(mon)).toBe('2026-W45');
    expect(isoWeek(sun)).toBe('2026-W45');
    expect(weeklyOffers(mon)).toEqual(weeklyOffers(sun));
    expect(new Set(weeklyOffers(mon)).size).toBe(3);
    const notOffered = (['vip_30', 'gift_vip_30', 'vip_90'] as const).find((id) => !weeklyOffers(mon).includes(id))!;
    expect(shopPrice(notOffered, 500, true, mon)).toBe(VIP_PRICES_V2[notOffered]);
    expect(shopPrice('vip_30', 500, false, mon)).toBe(500);
    const offered = weeklyOffers(mon)[0]!;
    expect(shopPrice(offered, 200, true, mon)).toBe(offerPrice(VIP_PRICES_V2[offered] ?? 200));
  });

  it('cases are bought into the inventory and can be given to a friend', async () => {
    const [a, b] = [await newPlayer(), await newPlayer()];
    await giveCoins(a.userId, 1000);
    const before = await coinsOf(a.userId);
    const r = await buyShopItem(db(), a.userId, { item: 'case_silver' });
    expect(await qtyOf(a.userId, 'case_silver')).toBe(1);
    expect(await coinsOf(a.userId)).toBe(before - r.price);
    await buyShopItem(db(), a.userId, { item: 'gift_case', recipient: b.username });
    expect(await qtyOf(b.userId, 'case_silver')).toBe(1);
    expect(await code(buyShopItem(db(), a.userId, { item: 'gift_case', recipient: a.username }))).toBe('gift_self');
  });

  it('VIP: one free instant repair a day, then the normal price', async () => {
    const p = await newPlayer();
    await makeVip(p.userId);
    await giveCoins(p.userId, 500);
    const acct = (await db().select().from(companies).where(eq(companies.ownerId, p.userId)))[0]!;
    const city = await cityByName('Sofia');
    const [truck] = await db().insert(vehicles).values({ companyId: acct.id, modelId: 'hemus-r18', plate: `T${Date.now() % 100000}`, color: '#1d4ed8', purchasePriceCents: 6_800_000, cityId: city.id, ownership: 'owned', condition: 50 }).returning();
    const before = await coinsOf(p.userId);
    expect((await buyShopItem(db(), p.userId, { item: 'instant_repair', vehicleId: truck!.id })).price).toBe(0);
    await db().update(vehicles).set({ condition: 50 }).where(eq(vehicles.id, truck!.id));
    expect((await buyShopItem(db(), p.userId, { item: 'instant_repair', vehicleId: truck!.id })).price).toBeGreaterThan(0);
    expect(await coinsOf(p.userId)).toBeLessThan(before);
  });

  it('VIP: a silver case once a week; not for players without VIP', async () => {
    const [vip, plain] = [await newPlayer(), await newPlayer()];
    await makeVip(vip.userId);
    await claimVipCase(db(), vip.userId);
    expect(await qtyOf(vip.userId, 'case_silver')).toBe(1);
    expect(await code(claimVipCase(db(), vip.userId))).toBe('already_claimed');
    expect(await code(claimVipCase(db(), plain.userId))).toBe('vip_only');
  });

  it('moving a depot takes its free trucks along', async () => {
    const p = await newPlayer();
    await giveCoins(p.userId, 1000);
    const acct = (await db().select().from(companies).where(eq(companies.ownerId, p.userId)))[0]!;
    const [sofia, plovdiv] = [await cityByName('Sofia'), await cityByName('Plovdiv')];
    const [depot] = await db().insert(depots).values({ companyId: acct.id, cityId: sofia.id, slots: 4 }).onConflictDoNothing().returning();
    const d = depot ?? (await db().select().from(depots).where(and(eq(depots.companyId, acct.id), eq(depots.cityId, sofia.id))))[0]!;
    await buyShopItem(db(), p.userId, { item: 'move_depot', depotId: d.id, cityId: plovdiv.id });
    expect((await db().select().from(depots).where(eq(depots.id, d.id)))[0]!.cityId).toBe(plovdiv.id);
    const idle = await db().select().from(vehicles).where(and(eq(vehicles.companyId, acct.id), eq(vehicles.status, 'idle')));
    expect(idle.every((v) => v.cityId !== sofia.id)).toBe(true);
  });

  it('first ТрансКоин pack ×2 and 10 % to the inviter; the next pack is not doubled; a refund takes the bonus back', async () => {
    const [inviter, buyer] = [await newPlayer(), await newPlayer()];
    await db().update(users).set({ referredById: inviter.userId }).where(eq(users.id, buyer.userId));
    const [i0, b0] = [await coinsOf(inviter.userId), await coinsOf(buyer.userId)];
    const first = await pay(buyer.userId, 'tc_550', 550, 0, 999, new Date('2026-11-11T12:00:00+02:00'));
    expect(await coinsOf(buyer.userId)).toBe(b0 + 1100);
    expect(await coinsOf(inviter.userId)).toBe(i0 + 55);
    await pay(buyer.userId, 'tc_100', 100, 0, 199, new Date('2026-11-11T12:05:00+02:00'));
    // patron level 1 (5 € paid before): +1 %, rounded.
    expect(await coinsOf(buyer.userId)).toBe(b0 + 1100 + 100 + 1);
    await db().transaction(async (tx) => { const [locked] = await tx.select().from(payments).where(eq(payments.id, first.id)).for('update'); await refundLocked(tx, locked!, new Date()); });
    expect(await coinsOf(buyer.userId)).toBe(b0 + 100 + 1);
    expect(await coinsOf(inviter.userId)).toBe(i0);
    const extras = await db().select().from(coinEntries).where(like(coinEntries.idempotencyKey, `payment-extra:${first.id}:%`));
    expect(extras.length).toBe(2);
  });

  it('the monthly card: VIP and ТрансКоин once a day; patron levels by everything paid', async () => {
    const p = await newPlayer();
    await pay(p.userId, 'month_card', 0, 30, 499);
    expect((await monthCardOf(db(), p.userId, new Date())).active).toBe(true);
    const c0 = await coinsOf(p.userId);
    await claimMonthCard(db(), p.userId);
    expect(await coinsOf(p.userId)).toBe(c0 + MONTH_CARD.coinsPerDay);
    expect(await code(claimMonthCard(db(), p.userId))).toBe('already_claimed');
    expect((await db().select().from(jobState).where(eq(jobState.key, `month-card:${p.userId}`))).length).toBe(1);
    expect(patronLevel(0)).toBe(0);
    expect(patronLevel(500)).toBe(1);
    expect(patronLevel(50_000)).toBe(10);
  });
});
