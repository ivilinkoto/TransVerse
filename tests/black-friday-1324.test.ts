import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { PREMIUM_TRUCKS } from '@/lib/game/catalog';
import { paidProduct } from '@/lib/game/payments';
import { BLACK_FRIDAY_MORE, blackFridayCoins, isBlackFriday } from '@/lib/game/prewinter';
import { closeDb } from '@/server/db/client';
import { inventoryItems, payments, users } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { GameError } from '@/server/game/errors';
import { buyPremiumTruck } from '@/server/game/fleet';
import { settlePaid, startPayment } from '@/server/payments';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const FRIDAY = new Date('2026-11-28T12:00:00+02:00');
const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;

describe('1.3.2.4: Black Friday for the newer things', () => {
  it('30 % off ТрансКоин prices, only on the days', () => {
    expect(isBlackFriday(FRIDAY)).toBe(true);
    expect(blackFridayCoins(900, true)).toBe(630);
    expect(blackFridayCoins(900, false)).toBe(900);
  });

  it('a premium truck costs 30 % less on Black Friday', async () => {
    const p = await newPlayer();
    await db().update(users).set({ level: 10, vipLevel: 2 }).where(eq(users.id, p.userId));
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: 1_000, reason: 'purchase', description: 'test', idempotencyKey: `bf:${p.userId}` }));
    const model = PREMIUM_TRUCKS().find((m) => m.id === 'hemus-r20-express')!;
    await buyPremiumTruck(db(), p.userId, model.id, p.hq.id, FRIDAY);
    expect(await coins(p.userId)).toBe(1_000 - blackFridayCoins(model.premium!.coins, true));
  });

  it('the Black Friday pack is sold only on the days; coin packs get +50 % then', async () => {
    const p = await newPlayer();
    expect(await code(startPayment(db(), p.userId, { productId: 'black_friday_pack', provider: 'stripe', consent: true }, new Date('2026-11-20T12:00:00+02:00')))).toBe('not_in_season');
    const { payment } = await startPayment(db(), p.userId, { productId: 'black_friday_pack', provider: 'stripe', consent: true }, FRIDAY);
    await db().transaction((tx) => settlePaid(tx, payment, { amountCents: payment.amountCents, currency: 'eur' }, {}, FRIDAY));
    const [cases] = await db().select().from(inventoryItems).where(and(eq(inventoryItems.userId, p.userId), eq(inventoryItems.itemId, 'case_gold')));
    expect(cases?.qty).toBe(3);
    expect(paidProduct('black_friday_pack')).toMatchObject({ coins: 3000, vipDays: 30 });
    // A coin pack on Black Friday (not the first purchase): +50 % on top.
    const before = await coins(p.userId);
    const [row] = await db().insert(payments).values({ userId: p.userId, provider: 'stripe', productId: 'tc_550', coins: 550, vipDays: 0, amountCents: 999, currency: 'eur', consentAt: FRIDAY }).returning();
    await db().update(payments).set({ status: 'paid', paidAt: FRIDAY }).where(eq(payments.id, payment.id));
    await db().transaction((tx) => settlePaid(tx, row!, { amountCents: 999, currency: 'eur' }, {}, FRIDAY));
    expect((await coins(p.userId)) - before).toBeGreaterThanOrEqual(550 + Math.round(550 * BLACK_FRIDAY_MORE.packBonus));
  });

  it('the banner: the three days before, then while it runs; nothing otherwise', async () => {
    const { blackFridayPhase } = await import('@/lib/game/prewinter');
    expect(blackFridayPhase(new Date('2026-11-24T12:00:00+02:00'))).toEqual({ phase: 'soon', days: 3 });
    expect(blackFridayPhase(new Date('2026-11-26T20:00:00+02:00'))).toEqual({ phase: 'soon', days: 1 });
    expect(blackFridayPhase(FRIDAY)).toEqual({ phase: 'on' });
    expect(blackFridayPhase(new Date('2026-11-20T12:00:00+02:00'))).toBeNull();
    expect(blackFridayPhase(new Date('2026-12-01T12:00:00+02:00'))).toBeNull();
  });

  it('one notification to the recent players on the first morning, once', async () => {
    const { blackFridayNotice } = await import('@/server/game/black-friday');
    const { notifications } = await import('@/server/db/schema');
    // A year of its own (other tests may run the worker on the real days).
    const year = 2100 + Math.floor(Math.random() * 800);
    const morning = new Date(`${year}-11-27T10:00:00+02:00`);
    const p = await newPlayer();
    await db().update(users).set({ lastSeenAt: morning }).where(eq(users.id, p.userId));
    expect(await blackFridayNotice(db(), new Date(`${year}-11-27T07:00:00+02:00`))).toBe(0);
    expect(await blackFridayNotice(db(), morning)).toBeGreaterThan(0);
    expect(await blackFridayNotice(db(), new Date(morning.getTime() + 3_600_000))).toBe(0);
    const mine = await db().select({ href: notifications.href }).from(notifications).where(and(eq(notifications.userId, p.userId), eq(notifications.href, '/game/shop')));
    expect(mine.length).toBe(1);
  });
});

describe('1.3.3: the shop shows every paid pack by its name', () => {
  it('passes, cases, VIP+ and the Black Friday pack read by name and description; plain packs as „N TC“ / „VIP N дни“', async () => {
    const { PAID_PRODUCTS, namedProduct } = await import('@/lib/game/payments');
    const named = (id: string) => namedProduct(PAID_PRODUCTS.find((p) => p.id === id)!);
    for (const id of ['black_friday_pack', 'pass_premium', 'pass_plus', 'gold_cases_10', 'vip_plus', 'speed_pack', 'level_offer', 'month_card', 'supporter_pack']) expect(named(id), id).toBe(true);
    for (const id of ['tc_60', 'tc_100', 'tc_550', 'tc_1200', 'tc_3200', 'vip_30_direct']) expect(named(id), id).toBe(false);
    // A pack with no TC is never shown as „0 TC“.
    for (const p of PAID_PRODUCTS) if (!p.coins && !p.vipDays) expect(namedProduct(p), p.id).toBe(true);
  });
});
