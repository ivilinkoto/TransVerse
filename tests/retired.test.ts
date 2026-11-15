import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/server/db/client';
import { coinEntries, companies, hitchhikers, jobState, ledgerEntries, organizations, plateAuctions, shareHoldings, vehicles } from '@/server/db/schema';
import { FEATURES, featureLive, RETIRED_PAGES } from '@/lib/game/features';
import { companyForUser } from '@/server/game/company';
import { acceptContract } from '@/server/game/deliveries';
import { settleRetired } from '@/server/game/retired';
import { cityByName, makeContract, newPlayer, playerWithCompany } from './helpers';

const db = () => getDb();

afterAll(async () => {
  await closeDb();
});

describe('„Просто“: the removed features', () => {
  it('are gone from the features; their old pages lead to „Игри и награди“', () => {
    for (const id of ['shares', 'duels', 'rally', 'smuggling', 'trailer_hire', 'cb_radio']) expect(id in FEATURES, id).toBe(false);
    expect(RETIRED_PAGES).toContain('/game/shares');
    expect(featureLive('daily_route', new Date('2030-01-01'))).toBe(true);
  });

  it('give back shares, the leading plate bid and a hitchhiker’s fare, once', async () => {
    await db().delete(jobState).where(eq(jobState.key, 'retired-2026-11-14'));
    const owner = await playerWithCompany();
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await db().update(organizations).set({ sharePriceCents: 1_000 }).where(eq(organizations.id, org!.id));
    const holder = await newPlayer();
    await db().insert(shareHoldings).values({ organizationId: org!.id, userId: holder.userId, shares: 10, costCents: 12_000, lockedUntil: new Date(), updatedAt: new Date() });
    const bidder = await newPlayer();
    const week = `test-${Date.now()}`;
    await db().insert(plateAuctions).values({ weekKey: week, plate: 'TV 0001 TV', endsAt: new Date(Date.now() + 86_400_000), bidUserId: bidder.userId, bidCoins: 40, bids: 1, createdAt: new Date() });

    // A hitchhiker aboard a trip under way, and one still waiting.
    const driver = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, driver.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const trip = await acceptContract(db(), driver.userId, (await makeContract('Sofia', 'Plovdiv')).id, truck!.id);
    const sofia = await cityByName('Sofia');
    await db().delete(hitchhikers).where(eq(hitchhikers.deliveryId, trip.id));
    const [aboard] = await db().insert(hitchhikers).values({ userId: driver.userId, deliveryId: trip.id, persona: 0, fromCityId: sofia.id, toCityId: sofia.id, fareCents: 77_00, status: 'aboard', waitUntil: new Date() }).returning();

    const out = await settleRetired(db());
    expect(out).not.toBeNull();
    const fare = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), eq(ledgerEntries.category, 'hitchhiker')));
    expect(fare.map((f) => Number(f.amountCents))).toEqual([77_00]);
    const [rider] = await db().select().from(hitchhikers).where(eq(hitchhikers.id, aboard!.id));
    expect(rider).toMatchObject({ status: 'done' });
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
