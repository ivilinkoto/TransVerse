import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/server/db/client';
import { coinEntries, jobState, ledgerEntries, organizations, plateAuctions, shareHoldings } from '@/server/db/schema';
import { featureLive, RETIRED, RETIRED_PAGES } from '@/lib/game/features';
import { companyForUser } from '@/server/game/company';
import { settleRetired } from '@/server/game/retired';
import { newPlayer, playerWithCompany } from './helpers';

const db = () => getDb();

afterAll(async () => {
  await closeDb();
});

describe('„Просто“: the removed features', () => {
  it('are off for everyone, the staff too, and their pages lead to „Игри и награди“', () => {
    for (const id of RETIRED) {
      expect(featureLive(id, new Date('2030-01-01')), id).toBe(false);
      expect(featureLive(id, new Date('2030-01-01'), true), id).toBe(false);
    }
    expect(RETIRED_PAGES).toContain('/game/shares');
    expect(featureLive('daily_route', new Date('2030-01-01'))).toBe(true);
  });

  it('give back shares and the leading plate bid, once', async () => {
    await db().delete(jobState).where(eq(jobState.key, 'retired-2026-11-14'));
    const owner = await playerWithCompany();
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await db().update(organizations).set({ sharePriceCents: 1_000 }).where(eq(organizations.id, org!.id));
    const holder = await newPlayer();
    await db().insert(shareHoldings).values({ organizationId: org!.id, userId: holder.userId, shares: 10, costCents: 12_000, lockedUntil: new Date(), updatedAt: new Date() });
    const bidder = await newPlayer();
    const week = `test-${Date.now()}`;
    await db().insert(plateAuctions).values({ weekKey: week, plate: 'TV 0001 TV', endsAt: new Date(Date.now() + 86_400_000), bidUserId: bidder.userId, bidCoins: 40, bids: 1, createdAt: new Date() });

    const out = await settleRetired(db());
    expect(out).not.toBeNull();
    const account = await companyForUser(db(), holder.userId);
    const back = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account.id), eq(ledgerEntries.category, 'share_trade')));
    expect(back.map((e) => Number(e.amountCents))).toEqual([12_000]); // what it cost (more than 10 × 10 лв.)
    expect(await db().select().from(shareHoldings).where(eq(shareHoldings.userId, holder.userId))).toHaveLength(0);
    const coins = await db().select().from(coinEntries).where(and(eq(coinEntries.userId, bidder.userId), eq(coinEntries.reason, 'plate_auction')));
    expect(coins.map((c) => c.amount)).toEqual([40]);
    const [auction] = await db().select().from(plateAuctions).where(eq(plateAuctions.weekKey, week));
    expect(auction!.settledAt).not.toBeNull();

    expect(await settleRetired(db())).toBeNull();
  });
});
