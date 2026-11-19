import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { BADGES } from '@/lib/game/halloween';
import { paidProduct } from '@/lib/game/payments';
import { SUPPORTER_PACK } from '@/lib/game/shop-v2';
import { closeDb } from '@/server/db/client';
import { payments, userBadges, users } from '@/server/db/schema';
import { supporterPackOpen } from '@/server/game/shop-v2';
import { refundLocked, settlePaid } from '@/server/payments';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const NOW = new Date('2026-11-20T12:00:00+02:00');
const badge = async (userId: string) => (await db().select().from(userBadges).where(and(eq(userBadges.userId, userId), eq(userBadges.badge, SUPPORTER_PACK.badge)))).length;

describe('„Подкрепи TransVerse“', () => {
  it('is a 1.3.2 pack with a badge, open once per account until the end of 2026', async () => {
    expect(FEATURES.supporter_pack).toBe('1.3.2');
    expect(paidProduct('supporter_pack')).toMatchObject({ priceCents: 499, coins: 300, vipDays: 0 });
    expect(BADGES[SUPPORTER_PACK.badge]!.label).toBe('Поддръжник от първите дни');
    const p = await newPlayer();
    expect(await supporterPackOpen(db(), p.userId, NOW)).toBe(true);
    expect(await supporterPackOpen(db(), p.userId, new Date('2027-01-01T00:00:00+02:00'))).toBe(false);
  });

  it('gives the coins and the badge when paid, takes the badge back on a refund', async () => {
    const p = await newPlayer();
    const [before] = await db().select({ coins: users.coins }).from(users).where(eq(users.id, p.userId));
    const [row] = await db().insert(payments).values({ userId: p.userId, provider: 'stripe', productId: 'supporter_pack', coins: 300, vipDays: 0, amountCents: 499, currency: 'eur', consentAt: NOW }).returning();
    await db().transaction((tx) => settlePaid(tx, row!, { amountCents: 499, currency: 'eur' }, {}, NOW));
    const [after] = await db().select({ coins: users.coins }).from(users).where(eq(users.id, p.userId));
    expect(after!.coins - before!.coins).toBe(300);
    expect(await badge(p.userId)).toBe(1);
    // Once per account.
    expect(await supporterPackOpen(db(), p.userId, NOW)).toBe(false);
    const [paid] = await db().select().from(payments).where(eq(payments.id, row!.id));
    await db().transaction((tx) => refundLocked(tx, paid!, NOW));
    expect(await badge(p.userId)).toBe(0);
  });
});
