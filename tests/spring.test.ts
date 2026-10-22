import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { isMarta, MARTA, springDiscount } from '@/lib/game/marta';
import { isNightShift, NIGHT, OVERSIZE, oversizeCostCents, roadWorksFactor } from '@/lib/game/roads';
import { closeDb } from '@/server/db/client';
import { companies, contracts, deliveries, ledgerEntries, roadWorks, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyTrailer, buyVehicle, coupleTrailer } from '@/server/game/fleet';
import { giveMartenitsa, martaState, spotStork, storkOfDay } from '@/server/game/marta';
import { ensureOversizeLoads, ensureRoadWorks } from '@/server/game/roads';
import { respondFriendRequest, sendFriendRequest } from '@/server/game/social';
import { approximateProvider } from '@/server/geo/routing';
import { db, grantLicences, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const MARCH = new Date('2027-03-03T10:00:00Z');

describe('Баба Марта', () => {
  it('dates, spring cleaning, a martenitsa for a friend and the stork', async () => {
    expect(isMarta(MARCH)).toBe(true);
    expect(isMarta(new Date('2027-04-01T10:00:00Z'))).toBe(false);
    expect(springDiscount(MARCH)).toBe(MARTA.springDiscount);
    expect(springDiscount(new Date('2027-05-01T10:00:00Z'))).toBe(0);

    const a = await newPlayer();
    const b = await newPlayer();
    expect(await code(giveMartenitsa(db(), a.userId, b.userId, MARCH))).toBe('not_friends');
    await sendFriendRequest(db(), a.userId, b.userId);
    const { rows } = await db().execute<{ id: string }>(sql`select id from friendships where requester_id = ${a.userId}`);
    await respondFriendRequest(db(), b.userId, rows[0]!.id, true);
    expect(await code(giveMartenitsa(db(), a.userId, b.userId, new Date('2027-05-01T10:00:00Z')))).toBe('not_in_season');
    await giveMartenitsa(db(), a.userId, b.userId, MARCH);
    expect(await code(giveMartenitsa(db(), a.userId, b.userId, MARCH))).toBe('already_given');
    expect((await martaState(db(), a.userId)).quests.find((q) => q.id === 'm_gift')!.done).toBe(true);

    const stork = await storkOfDay(db(), MARCH);
    expect(stork).not.toBeNull();
    expect((await storkOfDay(db(), MARCH))!.id).toBe(stork!.id);
    const before = (await db().select().from(users).where(eq(users.id, a.userId)))[0]!.coins;
    await spotStork(db(), a.userId, MARCH);
    expect(await code(spotStork(db(), a.userId, MARCH))).toBe('already_spotted');
    expect((await db().select().from(users).where(eq(users.id, a.userId)))[0]!.coins).toBe(before + MARTA.storkCoins);
  });
});

describe('the road in v1.5', () => {
  it('night shift: faster, and a bonus on time', async () => {
    const night = new Date('2027-03-02T21:30:00Z'); // 23:30 in Sofia
    expect(isNightShift(night)).toBe(true);
    expect(isNightShift(new Date('2027-03-02T10:00:00Z'))).toBe(false);
    const p = await playerWithCompany('Sofia');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    const c = await makeContract('Sofia', 'Plovdiv', { expiresAt: new Date('2027-04-01T00:00:00Z') });
    await acceptContract(db(), p.userId, c.id, truck!.id, night);
    const [d] = await db().select().from(deliveries).where(eq(deliveries.contractId, c.id));
    expect(d!.nightShift).toBe(true);
    await settleDueDeliveries(db(), new Date(d!.etaAt.getTime() + 1000));
    const bonus = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), eq(ledgerEntries.category, 'night_bonus')));
    expect(bonus).toHaveLength(1);
    expect(bonus[0]!.amountCents).toBe(Math.round(c.rewardCents * NIGHT.bonusShare));
  });

  it('road works slow the trips through their country', async () => {
    expect(roadWorksFactor(['BG', 'RO'], [{ countryCode: 'RO', delay: 0.1 }, { countryCode: 'DE', delay: 0.15 }])).toBeCloseTo(1.1);
    expect(roadWorksFactor(['BG'], [])).toBe(1);
    await db().delete(roadWorks);
    const now = new Date();
    const w = await ensureRoadWorks(db(), now);
    expect(w).not.toBeNull();
    expect(await ensureRoadWorks(db(), new Date(now.getTime() + 60_000))).toBeNull(); // not again so soon
  });

  it('oversize loads: low-bed only, permit and escort paid at the end', async () => {
    // The worker tick of another test file may have made them already.
    await ensureOversizeLoads(db(), new Date(), approximateProvider);
    const open = await db().select().from(contracts).where(and(eq(contracts.oversize, true), eq(contracts.status, 'open')));
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((c) => c.cargoType === 'special' && OVERSIZE.goods.includes(c.goods as never))).toBe(true);

    const p = await playerWithCompany('Sofia');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    await db().update(companies).set({ balanceCents: 2_000_000_00 }).where(eq(companies.id, acc!.id));
    await db().update(users).set({ level: 10, xp: 9_999_999 }).where(eq(users.id, p.userId));
    await grantLicences(p.userId, 'oversize');
    const tractor = await buyVehicle(db(), p.userId, 'rila-xt620', p.hq.id);
    const lowbed = await buyTrailer(db(), p.userId, 'lowbed-4', p.hq.id);
    await coupleTrailer(db(), p.userId, tractor.id, lowbed.id);
    const { drivers } = await import('@/server/db/schema');
    await db().update(drivers).set({ vehicleId: tractor.id }).where(and(eq(drivers.companyId, acc!.id), eq(drivers.isOwner, true)));
    const c = await makeContract('Sofia', 'Plovdiv', { cargoType: 'special', goods: OVERSIZE.goods[0], weightTons: 30, oversize: true, rewardCents: 20_000_00 });
    await acceptContract(db(), p.userId, c.id, tractor.id);
    const [d] = await db().select().from(deliveries).where(eq(deliveries.contractId, c.id));
    expect((d!.estimatedCosts as { oversizeCents: number }).oversizeCents).toBe(oversizeCostCents(c.distanceKm));
    await settleDueDeliveries(db(), new Date(d!.etaAt.getTime() + 1000));
    const paid = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc!.id), eq(ledgerEntries.category, 'oversize')));
    expect(paid.map((e) => e.amountCents)).toEqual([-oversizeCostCents(c.distanceKm)]);
  });
});
