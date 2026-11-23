import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { levelForSpent, nextVipLevel, vipLevel, VIP_LEVELS } from '@/lib/game/vip-levels';
import { unseenRelease } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { payments, users } from '@/server/db/schema';
import { refundLocked, settlePaid } from '@/server/payments';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const level = async (userId: string) => (await db().select({ l: users.vipLevel }).from(users).where(eq(users.id, userId)))[0]!.l;
async function pay(userId: string, cents: number) {
  const [row] = await db().insert(payments).values({ userId, provider: 'stripe', productId: 'tc_100', coins: 0, vipDays: 0, amountCents: cents, currency: 'eur', consentAt: new Date() }).returning();
  await db().transaction((tx) => settlePaid(tx, row!, { amountCents: cents, currency: 'eur' }, {}, new Date()));
  return row!;
}

describe('1.3.2.2 VIP levels', () => {
  it('go by what was spent: 5, 20, 50, 100, 200 €', () => {
    expect([0, 499, 500, 1_999, 2_000, 5_000, 9_999, 10_000, 20_000, 99_999].map(levelForSpent)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 5, 5]);
    expect(VIP_LEVELS).toHaveLength(6);
    expect(vipLevel(5)).toMatchObject({ xp: 0.1, garage: 0.1, pay: 0.05, depotSlots: 2 });
    expect(vipLevel(99).level).toBe(5);
    expect(nextVipLevel(700, 1)).toEqual({ level: 2, leftCents: 1_300 });
    expect(nextVipLevel(30_000, 5)).toBeNull();
  });

  it('rise with each payment, fall back with a refund, never below the kept floor', async () => {
    const p = await newPlayer();
    expect(await level(p.userId)).toBe(0);
    await pay(p.userId, 999);
    expect(await level(p.userId)).toBe(1);
    const big = await pay(p.userId, 4_999);
    expect(await level(p.userId)).toBe(3);
    const [paid] = await db().select().from(payments).where(eq(payments.id, big.id));
    await db().transaction((tx) => refundLocked(tx, paid!, new Date()));
    expect(await level(p.userId)).toBe(1);
    // The first VIPs keep VIP5.
    await db().update(users).set({ vipLevelFloor: 5 }).where(eq(users.id, p.userId));
    await pay(p.userId, 199);
    expect(await level(p.userId)).toBe(5);
  });

  it('a player who missed both 1.3.2.1 and 1.3.2.2 sees them one at a time, oldest first', () => {
    const at = new Date('2026-11-24T12:00:00+02:00');
    expect(unseenRelease('1.3.2', at)?.version).toBe('1.3.2.1');
    expect(unseenRelease('1.3.2.1', at)?.version).toBe('1.3.2.2');
    expect(unseenRelease('1.3.2.2', at)).toBeNull();
    // After a long break: only the latest.
    expect(unseenRelease('1.2.3.2', at)?.version).toBe('1.3.2.2');
  });
});
