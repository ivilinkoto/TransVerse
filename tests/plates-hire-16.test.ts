import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { periodWindow } from '@/lib/game/missions';
import { isRarePlate, nextMinBid, PLATE_AUCTION } from '@/lib/game/plates';
import { closeDb } from '@/server/db/client';
import { companies, plateAuctions, trailers, users, vehicles } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { sellTrailer } from '@/server/game/fleet';
import { bidForPlate, ensurePlateAuction, fitRarePlate, settlePlateAuctions } from '@/server/game/plates';
import { buyShopItem } from '@/server/game/shop';
import { endTrailerHires, hireTrailer, offerTrailer } from '@/server/game/trailer-hire';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;
const account = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;

describe('rules', () => {
  it('rare plates and the bid steps', () => {
    expect(isRarePlate('7')).toBe(true);
    expect(isRarePlate(' tv 1 ')).toBe(true);
    expect(isRarePlate('CA 1234')).toBe(false);
    expect(nextMinBid(null)).toBe(PLATE_AUCTION.startCoins);
    expect(nextMinBid(200)).toBe(220);
    expect(nextMinBid(50)).toBe(60);
  });
});

describe('v1.6 plates and trailers', () => {
  it('the plate auction: bids held, the outbid refunded, the winner fits the plate; the shop refuses it', async () => {
    const week = periodWindow('weekly', new Date());
    await db().delete(plateAuctions).where(eq(plateAuctions.weekKey, week.key));
    const a = (await ensurePlateAuction(db()))!;
    expect(isRarePlate(a.plate)).toBe(true);
    const [p1, p2] = [await newPlayer(), await newPlayer()];
    for (const p of [p1, p2]) await db().update(users).set({ coins: 1000 }).where(eq(users.id, p.userId));
    await bidForPlate(db(), p1.userId, 200, new Date(), a.weekKey);
    expect(await coins(p1.userId)).toBe(800);
    expect(await code(bidForPlate(db(), p2.userId, 210, new Date(), a.weekKey))).toBe('low');
    await bidForPlate(db(), p2.userId, 220, new Date(), a.weekKey);
    expect(await coins(p1.userId)).toBe(1000);
    expect(await coins(p2.userId)).toBe(780);
    await settlePlateAuctions(db(), new Date(a.endsAt.getTime() + 1000));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, (await account(p2.userId)).id));
    await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, truck!.id));
    expect(await code(fitRarePlate(db(), p1.userId, a.weekKey, truck!.id))).toBe('not_won');
    await fitRarePlate(db(), p2.userId, a.weekKey, truck!.id);
    expect((await db().select().from(vehicles).where(eq(vehicles.id, truck!.id)))[0]!.plate).toBe(a.plate);
    expect(await code(buyShopItem(db(), p1.userId, { item: 'custom_plate', vehicleId: truck!.id, plate: '9' }))).not.toBe('ok');
    expect(await code(buyShopItem(db(), p2.userId, { item: 'custom_plate', vehicleId: truck!.id, plate: 'TV 7' }))).toBe('rare_plate');
  });

  it('a trailer for hire: paid up front, the owner cannot use it, it goes back at the end', async () => {
    const [owner, renter] = [await newPlayer(), await newPlayer()];
    const acc = await account(owner.userId);
    const [t] = await db().insert(trailers).values({ companyId: acc.id, modelId: 'curtain-13', plate: `H${Date.now().toString(36).slice(-6).toUpperCase()}`, cityId: owner.hq.id, purchasePriceCents: 30_000_00 }).returning();
    const offer = await offerTrailer(db(), owner.userId, { trailerId: t!.id, pricePerDayCents: 80_00, maxDays: 3 });
    expect(await code(sellTrailer(db(), owner.userId, t!.id))).toBe('hired_out');
    expect(await code(hireTrailer(db(), renter.userId, offer.id, 4))).toBe('days');
    const [o0, r0] = [(await account(owner.userId)).balanceCents, (await account(renter.userId)).balanceCents];
    const now = new Date();
    const h = await hireTrailer(db(), renter.userId, offer.id, 2, now);
    expect(h.cost).toBe(160_00);
    expect((await account(owner.userId)).balanceCents).toBe(o0 + 160_00);
    expect((await account(renter.userId)).balanceCents).toBe(r0 - 160_00);
    const [copy] = await db().select().from(trailers).where(eq(trailers.id, h.trailerId));
    expect(copy!.ownership).toBe('hired');
    expect(await code(hireTrailer(db(), owner.userId, offer.id, 1))).toBe('taken');
    await db().update(trailers).set({ condition: 80 }).where(eq(trailers.id, h.trailerId));
    expect(await endTrailerHires(db(), new Date(now.getTime() + 2 * 86_400_000 + 1000))).toBeGreaterThanOrEqual(1);
    const [back] = await db().select().from(trailers).where(eq(trailers.id, t!.id));
    expect(back!.hiredOut).toBe(false);
    expect(back!.condition).toBe(80);
    expect((await db().select().from(trailers).where(eq(trailers.id, h.trailerId)))[0]!.soldAt).not.toBeNull();
  });
});
