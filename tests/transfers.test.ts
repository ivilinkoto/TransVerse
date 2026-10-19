import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { TRANSFER_RULES } from '@/lib/game/transfers';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries, notifications, users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { blockUser } from '@/server/game/moderation';
import { sendMoney, transfersOf } from '@/server/game/transfers';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const now = new Date();
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;

/** A player who may send money: level 5, account two weeks old, its own network. */
async function sender(cash = 200_000_00) {
  const p = await newPlayer();
  await db().update(users).set({ level: 5, createdAt: new Date(now.getTime() - 14 * 86_400_000), signupIpHash: `net-${p.userId}` }).where(eq(users.id, p.userId));
  await db().update(companies).set({ balanceCents: cash }).where(eq(companies.ownerId, p.userId));
  return p;
}
async function receiver() {
  const p = await newPlayer();
  await db().update(users).set({ signupIpHash: `net-${p.userId}` }).where(eq(users.id, p.userId));
  return p;
}

describe('money transfers', () => {
  it('moves the amount, charges the fee and tells the receiver', async () => {
    const a = await sender();
    const b = await receiver();
    const before = await balance(b.userId);
    const r = await sendMoney(db(), a.userId, { toUserId: b.userId, amount: 1000, note: 'за гориво' }, null, now);
    expect(r.feeCents).toBe(30_00);
    expect(await balance(a.userId)).toBe(200_000_00 - 1000_00 - 30_00);
    expect(await balance(b.userId)).toBe(before + 1000_00);
    const titles = (await db().select().from(notifications).where(eq(notifications.userId, b.userId))).map((n) => n.title);
    expect(titles).toContainEqual(expect.stringContaining('ти изпрати 1000 лв.'));
    const inLedger = await db().select().from(ledgerEntries).where(eq(ledgerEntries.refId, r.id));
    expect(inLedger.map((e) => e.category).sort()).toEqual(['transfer_in', 'transfer_out', 'transfer_out']);
    const mine = await transfersOf(db(), a.userId);
    expect(mine[0]).toMatchObject({ outgoing: true, amountCents: 1000_00, note: 'за гориво' });
  });

  it('keeps new and low-level accounts, self, same network and blocked players out', async () => {
    const a = await sender();
    const b = await receiver();
    expect(await code(sendMoney(db(), a.userId, { toUserId: a.userId, amount: 500 }, null, now))).toBe('self');

    const fresh = await newPlayer();
    await db().update(users).set({ level: 5 }).where(eq(users.id, fresh.userId));
    expect(await code(sendMoney(db(), fresh.userId, { toUserId: b.userId, amount: 500 }, null, now))).toBe('transfer_locked');
    const low = await sender();
    await db().update(users).set({ level: TRANSFER_RULES.minLevel - 1 }).where(eq(users.id, low.userId));
    expect(await code(sendMoney(db(), low.userId, { toUserId: b.userId, amount: 500 }, null, now))).toBe('transfer_locked');

    // Same network: at sign-up, or the network the sender is on right now.
    await db().update(users).set({ signupIpHash: `net-${a.userId}` }).where(eq(users.id, b.userId));
    expect(await code(sendMoney(db(), a.userId, { toUserId: b.userId, amount: 500 }, null, now))).toBe('same_network');
    const c = await receiver();
    expect(await code(sendMoney(db(), a.userId, { toUserId: c.userId, amount: 500 }, `net-${c.userId}`, now))).toBe('same_network');

    const d = await receiver();
    await blockUser(db(), d.userId, a.userId);
    expect(await code(sendMoney(db(), a.userId, { toUserId: d.userId, amount: 500 }, null, now))).toBe('blocked');
  });

  it('enforces the daily limit and the balance', async () => {
    const a = await sender(1_000_000_00);
    const b = await receiver();
    await sendMoney(db(), a.userId, { toUserId: b.userId, amount: 40_000 }, null, now);
    expect(await code(sendMoney(db(), a.userId, { toUserId: b.userId, amount: 10_001 }, null, now))).toBe('daily_limit');
    expect(await code(sendMoney(db(), a.userId, { toUserId: b.userId, amount: 10_000 }, null, now))).toBe('ok');
    // A day later the limit is free again.
    expect(await code(sendMoney(db(), a.userId, { toUserId: b.userId, amount: 5_000 }, null, new Date(now.getTime() + 25 * 3_600_000)))).toBe('ok');

    const poor = await sender(500_00);
    expect(await code(sendMoney(db(), poor.userId, { toUserId: b.userId, amount: 500 }, null, now))).toBe('insufficient_funds');
    expect(await balance(poor.userId)).toBe(500_00);
  });
});
