import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { recordMonth } from '@/lib/game/community';
import { RELIEF } from '@/lib/game/relief';
import { TRUCK_CONTEST } from '@/lib/game/truck-contest';
import { closeDb } from '@/server/db/client';
import { companies, contracts, globalEvents, jobState, truckContestEntries, userBadges, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { runRelief } from '@/server/game/relief';
import { enterTruck, lastWinners, settleTruckContest, truckContestView, voteTruck } from '@/server/game/truck-contest';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const truckOf = async (userId: string) => {
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
  return { acc: acc!, truck: truck! };
};
const coins = async (userId: string) => (await db().select().from(users).where(eq(users.id, userId)))[0]!.coins;

describe('v1.8 community', () => {
  it('a humanitarian convoy: an event and relief loads; a relief load on time pays ТрансКоин and the badge', async () => {
    await db().delete(jobState).where(eq(jobState.key, 'humanitarian'));
    const r = await runRelief(db());
    expect(r?.country).toBeTruthy();
    const [e] = await db().select().from(globalEvents).where(eq(globalEvents.id, r!.eventId));
    expect(e!.countryCode).toBe(r!.country);
    const loads = await db().select().from(contracts).where(and(eq(contracts.humanitarian, true), eq(contracts.status, 'open')));
    expect(loads.length).toBeGreaterThan(0);
    // The second run in the same window starts nothing new.
    expect((await runRelief(db()))?.eventId).toBe(r!.eventId);

    const p = await newPlayer();
    const { acc, truck } = await truckOf(p.userId);
    const c0 = await coins(p.userId);
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv', { humanitarian: true })).id, truck.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc.id);
    expect(await coins(p.userId)).toBeGreaterThanOrEqual(c0 + RELIEF.coins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, RELIEF.badge)))).toHaveLength(1);
  });

  it('Камион на месеца: one truck a month, three votes, not for yourself; the winners after the month', async () => {
    const [a, b, c] = [await newPlayer(), await newPlayer(), await newPlayer()];
    // The starter truck is rented: make it the player's own.
    for (const p of [a, b]) await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, (await truckOf(p.userId)).truck.id));
    expect(await code(enterTruck(db(), c.userId, (await truckOf(c.userId)).truck.id))).toBe('rented');
    const ea = await enterTruck(db(), a.userId, (await truckOf(a.userId)).truck.id);
    expect(await code(enterTruck(db(), a.userId, (await truckOf(a.userId)).truck.id))).toBe('already_entered');
    const eb = await enterTruck(db(), b.userId, (await truckOf(b.userId)).truck.id);
    expect(await code(voteTruck(db(), a.userId, ea.id))).toBe('own_entry');
    await voteTruck(db(), c.userId, ea.id);
    await voteTruck(db(), c.userId, eb.id);
    expect(await code(voteTruck(db(), c.userId, eb.id))).toBe('already_voted');
    expect((await truckContestView(db(), c.userId)).votesLeft).toBe(1);

    // Last month: an entry with enough votes wins.
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    await db().insert(truckContestEntries).values({ month: recordMonth(prev), userId: b.userId, vehicleId: (await truckOf(b.userId)).truck.id, look: { modelId: 'hemus-r12-box', trailerModelId: null, color: '#123456', livery: null, cosmetics: null, trailerUpgrades: [], trailerLogo: null, trailerCosmetics: null }, title: 'Тест', votes: TRUCK_CONTEST.minVotes });
    await db().delete(jobState).where(eq(jobState.key, `truck-contest:${recordMonth(prev)}`));
    const c0 = await coins(b.userId);
    await settleTruckContest(db(), now);
    expect(await settleTruckContest(db(), now)).toBeNull();
    expect(await coins(b.userId)).toBe(c0 + TRUCK_CONTEST.prizes[0]);
    expect((await lastWinners(db(), now))?.winners[0]?.title).toBe('Тест');
  });
});
