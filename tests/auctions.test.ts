import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { AUCTION_RULES, floorBidCents, maxBidCents } from '@/lib/game/auctions';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, contracts, specialAuctions, vehicles } from '@/server/db/schema';
import { bidAuction, openAuction, settleAuctions } from '@/server/game/auctions';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { db, makeContract, newPlayer } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

/** An auction for a domestic lane (Sofia → Plovdiv), so no licences are needed. */
async function auction(slot: string, minutes = 15) {
  const now = new Date();
  const a = (await openAuction(db(), slot, now, new Date(now.getTime() + minutes * 60_000), undefined, 'statue'))!;
  const lane = await makeContract('Sofia', 'Plovdiv');
  await db().update(specialAuctions).set({ originCityId: lane.originCityId, destCityId: lane.destCityId, routeId: lane.routeId, distanceKm: lane.distanceKm, weightTons: 3 }).where(eq(specialAuctions.id, a.id));
  return (await db().select().from(specialAuctions).where(eq(specialAuctions.id, a.id)))[0]!;
}

describe('special load auctions', () => {
  it('rules: bids go down by a step, never below the floor', () => {
    expect(maxBidCents(1000_00, null)).toBe(1000_00);
    expect(maxBidCents(1000_00, 800_00)).toBe(792_00);
    expect(floorBidCents(1000_00)).toBe(400_00);
  });

  it('the lowest bid wins a private job; delivering it pays the bid and the coins', async () => {
    const a = await auction(`test-${Date.now()}-a`);
    const p1 = await newPlayer();
    const p2 = await newPlayer();
    expect(await code(bidAuction(db(), p1.userId, a.id, a.startPriceCents + 100))).toBe('bid_too_high');
    expect(await code(bidAuction(db(), p1.userId, a.id, floorBidCents(a.startPriceCents) - 100))).toBe('bid_too_low');
    await bidAuction(db(), p1.userId, a.id, a.startPriceCents - 100_00);
    expect(await code(bidAuction(db(), p2.userId, a.id, a.startPriceCents - 100_00))).toBe('bid_too_high'); // must beat it
    const low = Math.round(a.startPriceCents * 0.7 / 100) * 100;
    await bidAuction(db(), p2.userId, a.id, low);
    await db().update(specialAuctions).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(specialAuctions.id, a.id));
    expect(await settleAuctions(db())).toBeGreaterThanOrEqual(1);
    const [won] = await db().select().from(specialAuctions).where(eq(specialAuctions.id, a.id));
    expect(won).toMatchObject({ status: 'awarded', winningBidCents: low });
    const [job] = await db().select().from(contracts).where(eq(contracts.id, won!.contractId!));
    expect(job).toMatchObject({ status: 'trade', rewardCents: low, auctionId: a.id });

    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p2.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const d = await acceptContract(db(), p2.userId, job!.id, truck!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
    expect((await db().select().from(specialAuctions).where(eq(specialAuctions.id, a.id)))[0]!.status).toBe('delivered');
    const coins = await db().select().from(coinEntries).where(and(eq(coinEntries.userId, p2.userId), eq(coinEntries.idempotencyKey, `auction:${a.id}:coins`)));
    expect(coins.map((c) => c.amount)).toEqual([a.coins]);
  });

  it('a bid in the last minute adds a minute; a won job not sent in time is lost with reputation', async () => {
    const a = await auction(`test-${Date.now()}-b`, 0.5);
    const p = await newPlayer();
    await bidAuction(db(), p.userId, a.id, a.startPriceCents - 50_00);
    const [extended] = await db().select().from(specialAuctions).where(eq(specialAuctions.id, a.id));
    expect(extended!.endsAt.getTime() - a.endsAt.getTime()).toBe(AUCTION_RULES.extendMs);
    await db().update(specialAuctions).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(specialAuctions.id, a.id));
    await settleAuctions(db());
    const [won] = await db().select().from(specialAuctions).where(eq(specialAuctions.id, a.id));
    await db().update(contracts).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(contracts.id, won!.contractId!));
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    await db().update(companies).set({ reputation: 30 }).where(eq(companies.id, account!.id));
    await settleAuctions(db());
    expect((await db().select().from(specialAuctions).where(eq(specialAuctions.id, a.id)))[0]!.status).toBe('forfeited');
    expect((await db().select().from(companies).where(eq(companies.id, account!.id)))[0]!.reputation).toBe(30 - AUCTION_RULES.forfeitReputation);
  });
});
