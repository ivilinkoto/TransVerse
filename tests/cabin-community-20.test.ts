import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { CUPS, cupPoints, cupPrizes } from '@/lib/game/community-cups';
import { ERAS, eraAt, eraFits, nextEra } from '@/lib/game/eras';
import { LANE, laneCentre, replayLane } from '@/lib/game/lane';
import { nightShade, sunAltitude } from '@/lib/geo/sun';
import { closeDb } from '@/server/db/client';
import { communityCupEntries, communityTournaments, companies, contracts, ledgerEntries, users, vehicles } from '@/server/db/schema';
import { cabinTrips, playLane } from '@/server/game/cabin';
import { announceCup, cancelCup, createCup, joinCommunityCup, removeFromCup, settleCups } from '@/server/game/community-cups';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;
const truckOf = async (userId: string) => {
  const [account] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [truck] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, account!.id), eq(vehicles.status, 'idle')));
  return { account: account!, truck: truck! };
};

describe('eras', () => {
  it('four eras in turn by month; each favours its loads', () => {
    const months = Array.from({ length: 4 }, (_, i) => eraAt(new Date(Date.UTC(2027, 8 + i, 15))).id);
    expect(new Set(months).size).toBe(4);
    expect(eraAt(new Date(Date.UTC(2028, 0, 15))).id).toBe(eraAt(new Date(Date.UTC(2027, 8, 15))).id);
    expect(nextEra(new Date(Date.UTC(2027, 8, 15))).id).toBe(months[1]);
    const by = (id: string) => ERAS.find((e) => e.id === id)!;
    expect(eraFits(by('retro'), { livery: 'retro80', electric: false, cargo: 'pallets', km: 100 })).toBe(true);
    expect(eraFits(by('green'), { livery: null, electric: false, cargo: 'pallets', km: 100 })).toBe(false);
    expect(eraFits(by('highway'), { livery: null, electric: false, cargo: 'pallets', km: 900 })).toBe(true);
    expect(eraFits(by('industrial'), { livery: null, electric: false, cargo: 'steel', km: 10 })).toBe(true);
  });
});

describe('the cab and the lane', () => {
  it('the same bends for the same trip; following the lane earns three stars, letting go fewer', () => {
    expect(laneCentre('abc', 40)).toBe(laneCentre('abc', 40));
    const perfect: number[] = [];
    let x = laneCentre('trip-1', 0);
    for (let i = 0; i < LANE.ticks; i++) {
      const target = laneCentre('trip-1', i + 1);
      const input = target > x + LANE.steer / 2 ? 1 : target < x - LANE.steer / 2 ? -1 : 0;
      x += input * LANE.steer;
      perfect.push(input);
    }
    expect(replayLane('trip-1', perfect).stars).toBe(3);
    expect(replayLane('trip-1', Array(LANE.ticks).fill(1)).stars).toBe(0);
  });

  it('a trip under way shows in the cab; the lane pays once, only on a trip', async () => {
    const p = await newPlayer('Sofia');
    const c = await makeContract('Sofia', 'Plovdiv', { windowMinutes: 3 * 24 * 60 });
    const { account, truck } = await truckOf(p.userId);
    const d = await acceptContract(db(), p.userId, c.id, truck.id);
    const trips = await cabinTrips(db(), p.userId);
    expect(trips.map((t) => t.id)).toEqual([d.id]);
    expect(trips[0]!.segments.length).toBeGreaterThan(0);
    const r = await playLane(db(), p.userId, d.id, Array(LANE.ticks).fill(0));
    expect(r.stars).toBeGreaterThanOrEqual(0);
    expect(await code(playLane(db(), p.userId, d.id, []))).toBe('already');
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id);
    const other = await newPlayer('Sofia');
    expect(await code(playLane(db(), other.userId, d.id, []))).toBe('not_on_trip');
  });
});

describe('day and night on the map', () => {
  it('noon in Sofia in summer is bright, midnight is dark', () => {
    expect(sunAltitude(new Date('2027-06-21T10:00:00Z'), 42.7, 23.3)).toBeGreaterThan(60);
    expect(sunAltitude(new Date('2027-06-21T22:00:00Z'), 42.7, 23.3)).toBeLessThan(-10);
    expect(nightShade(30)).toBe(0);
    expect(nightShade(-20)).toBe(1);
  });
});

describe('community tournaments', () => {
  it('points, prizes and the split', () => {
    expect(cupPoints('tons', { tons: 12, km: 300, late: false })).toBe(12);
    expect(cupPoints('ontime', { tons: 12, km: 300, late: true })).toBe(0);
    expect(cupPrizes(10_000, 3)).toEqual([5_000, 3_000, 2_000]);
    expect(cupPrizes(10_000, 1)).toEqual([10_000]);
    expect(cupPrizes(10_001, 2).reduce((a, b) => a + b, 0)).toBe(10_001);
  });

  it('an organiser of level 10 puts up the prize; players join and drive; the first three are paid', async () => {
    const org = await newPlayer('Sofia');
    const now = new Date();
    const input = { name: 'Купа на Тракия', description: '', metric: 'tons' as const, cargoType: null, countryCode: null, startsAt: now, endsAt: new Date(now.getTime() + 2 * 86_400_000), prizeCents: CUPS.minPrizeCents, entryFeeCents: 100_00, maxPlayers: 10 };
    expect(await code(createCup(db(), org.userId, input))).toBe('level');
    await db().update(users).set({ level: CUPS.minLevel }).where(eq(users.id, org.userId));
    const before = await balance(org.userId);
    const cup = await createCup(db(), org.userId, input, now);
    expect(await balance(org.userId)).toBe(before - CUPS.minPrizeCents);
    const [a, b] = [await newPlayer('Sofia'), await newPlayer('Sofia')];
    await joinCommunityCup(db(), a.userId, cup.id, now);
    await joinCommunityCup(db(), b.userId, cup.id, now);
    expect(await code(joinCommunityCup(db(), b.userId, cup.id, now))).toBe('already');
    await announceCup(db(), org.userId, cup.id, 'Успех на всички!');
    expect(await code(announceCup(db(), a.userId, cup.id, 'хак'))).toBe('forbidden');
    // A drives a load; it counts.
    const c = await makeContract('Sofia', 'Plovdiv', { weightTons: 4, windowMinutes: 3 * 24 * 60 });
    const { account, truck } = await truckOf(a.userId);
    const d = await acceptContract(db(), a.userId, c.id, truck.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id);
    const [entry] = await db().select().from(communityCupEntries).where(and(eq(communityCupEntries.tournamentId, cup.id), eq(communityCupEntries.userId, a.userId)));
    expect(entry!.score).toBe(4);
    // B is removed and gets the fee back.
    const bBefore = await balance(b.userId);
    await removeFromCup(db(), org.userId, cup.id, b.userId);
    expect(await balance(b.userId)).toBe(bBefore + 100_00);
    const aBefore = await balance(a.userId);
    expect(await settleCups(db(), new Date(now.getTime() + 3 * 86_400_000))).toBeGreaterThanOrEqual(1);
    const [done] = await db().select().from(communityTournaments).where(eq(communityTournaments.id, cup.id));
    expect(done!.status).toBe('done');
    expect(await balance(a.userId)).toBe(aBefore + CUPS.minPrizeCents + 100_00);
    expect(await db().select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, `cup:${cup.id}:prize:1`))).toHaveLength(1);
    void contracts;
  });

  it('before the start the organiser may cancel: prize and fees come back', async () => {
    const org = await newPlayer('Sofia');
    await db().update(users).set({ level: CUPS.minLevel }).where(eq(users.id, org.userId));
    const now = new Date();
    const start = new Date(now.getTime() + 3_600_000);
    const before = await balance(org.userId);
    const cup = await createCup(db(), org.userId, { name: 'Отменена купа', description: '', metric: 'deliveries', cargoType: null, countryCode: null, startsAt: start, endsAt: new Date(start.getTime() + 86_400_000), prizeCents: CUPS.minPrizeCents, entryFeeCents: 50_00, maxPlayers: 5 }, now);
    const p = await newPlayer('Sofia');
    const pBefore = await balance(p.userId);
    await joinCommunityCup(db(), p.userId, cup.id, now);
    await cancelCup(db(), org.userId, cup.id, now);
    expect(await balance(org.userId)).toBe(before);
    expect(await balance(p.userId)).toBe(pBefore);
  });
});
