import { randomUUID } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { ECONOMY } from '@/lib/game/economy';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries } from '@/server/db/schema';
import { post } from '@/server/game/finance';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('1.3.2.1: lower pay and a cap on what a delivery pays on top of its freight', () => {
  it('pays 30 % more than the base rates (was 60 %), with bonuses up to 40 % of the freight', () => {
    expect(ECONOMY.rewardScale).toBe(1.3);
    expect(ECONOMY.bonusCapShare).toBe(0.4);
  });

  it('trims the bonuses of one delivery to the cap, across separate postings in the settlement', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const d = randomUUID();
    const key = (k: string) => `delivery:${d}:${k}`;
    await db().transaction(async (tx) => {
      await post(tx, acc!.id, [
        { category: 'freight', amountCents: 100_000, description: 'test', idempotencyKey: key('freight') },
        { category: 'bonus', amountCents: 30_000, description: 'test', idempotencyKey: key('bonus') },
        { category: 'fuel', amountCents: -20_000, description: 'test', idempotencyKey: key('fuel') },
      ]);
      // Later in the same settlement: only 10 000 of room is left, then none.
      await post(tx, acc!.id, [{ category: 'legacy_bonus', amountCents: 30_000, description: 'test', idempotencyKey: key('legacy') }]);
      await post(tx, acc!.id, [{ category: 'perfect_bonus', amountCents: 5_000, description: 'test', idempotencyKey: key('perfect') }]);
      // The cargo insurance pays out in full (not a bonus).
      await post(tx, acc!.id, [{ category: 'insurance_payout', amountCents: 50_000, description: 'test', idempotencyKey: key('payout') }]);
    });
    const rows = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), like(ledgerEntries.idempotencyKey, `delivery:${d}:%`)));
    const by = Object.fromEntries(rows.map((r) => [r.idempotencyKey.split(':')[2], r.amountCents]));
    expect(by).toEqual({ freight: 100_000, bonus: 30_000, fuel: -20_000, legacy: 10_000, payout: 50_000 });
  });

  it('leaves money that is not a delivery bonus alone', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    await db().transaction((tx) => post(tx, acc!.id, [{ category: 'bonus', amountCents: 500_000, description: 'test', idempotencyKey: `other:${acc!.id}` }]));
    const [row] = await db().select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, `other:${acc!.id}`));
    expect(row!.amountCents).toBe(500_000);
  });
});
