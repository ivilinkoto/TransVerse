import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { giftable, paidProduct } from '@/lib/game/payments';
import { closeDb } from '@/server/db/client';
import { payments, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { refundLocked, settlePaid, startPayment } from '@/server/payments';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;
const checkout = (userId: string, productId: string, giftTo?: string) => startPayment(db(), userId, { productId, provider: 'stripe', consent: true, giftTo }, new Date());

describe('1.3.2.2: a ТрансКоин pack bought for a friend', () => {
  it('only the plain packs, to a real other player', async () => {
    expect(FEATURES.gift_tc).toBe('1.3.2.2');
    expect(giftable(paidProduct('tc_550')!)).toBe(true);
    expect(giftable(paidProduct('vip_plus')!)).toBe(false);
    const a = await newPlayer();
    const b = await newPlayer();
    expect(await code(checkout(a.userId, 'vip_plus', b.username))).toBe('not_giftable');
    expect(await code(checkout(a.userId, 'tc_550', 'nobody_like_this_xx'))).toBe('recipient_not_found');
    expect(await code(checkout(a.userId, 'tc_550', a.username))).toBe('gift_self');
  });

  it('the coins go to the friend (no purchase bonuses); the buyer keeps the VIP level progress; a refund takes them back', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const { payment } = await checkout(a.userId, 'tc_550', b.username.toUpperCase());
    expect(payment.giftUserId).toBe(b.userId);
    const [a0, b0] = [await coins(a.userId), await coins(b.userId)];
    await db().transaction((tx) => settlePaid(tx, payment, { amountCents: payment.amountCents, currency: 'eur' }, {}, new Date()));
    expect(await coins(b.userId)).toBe(b0 + 550);
    expect(await coins(a.userId)).toBe(a0);
    expect((await db().select({ v: users.vipLevel }).from(users).where(eq(users.id, a.userId)))[0]!.v).toBe(1);
    const [paid] = await db().select().from(payments).where(eq(payments.id, payment.id));
    await db().transaction((tx) => refundLocked(tx, paid!, new Date()));
    expect(await coins(b.userId)).toBe(b0);
  });
});
