import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { CONVOYS, convoyShare, nextWeeklyDeparture, stretchSchedule } from '@/lib/game/convoys';
import { closeDb } from '@/server/db/client';
import { companies, convoyMembers, convoys, convoyStats, deliveries, friendships, ledgerEntries, organizations, users, vehicles } from '@/server/db/schema';
import { cancelConvoy, createConvoy, departConvoys, joinConvoy } from '@/server/game/convoys';
import { settleDelivery } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { joinCompany } from '@/server/game/membership';
import { cityByName, db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());
beforeAll(() => {
  process.env.ROAD_EVENTS = 'off';
});

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (userId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(userId)).id)))[0]!;
async function driver(level = 3) {
  const p = await newPlayer('Sofia');
  await db().update(users).set({ level }).where(eq(users.id, p.userId));
  return { ...p, truck: await truckOf(p.userId) };
}
async function lane() {
  return { from: await cityByName('Sofia'), to: await cityByName('Plovdiv') };
}
async function arrive(ids: string[]) {
  const rows = await db().select().from(deliveries).where(inArray(deliveries.id, ids));
  for (const r of rows) await db().transaction((tx) => settleDelivery(tx, r.id, new Date(r.etaAt.getTime() + 60_000)));
}
const bonusOf = async (userId: string, deliveryId: string) => (await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, (await accountOf(userId)).id), eq(ledgerEntries.category, 'convoy_bonus'), eq(ledgerEntries.refId, deliveryId))))[0];

describe('v1.10 organized convoys', () => {
  it('the rules: the share grows with the column, all on time and the roles; the column drives at one pace', () => {
    expect(convoyShare({ trucks: 2, onTime: true, allOnTime: false, role: 'member' })).toBeCloseTo(0.04);
    expect(convoyShare({ trucks: 9, onTime: true, allOnTime: true, role: 'leader' })).toBeCloseTo(0.12 + 0.05 + 0.02);
    expect(convoyShare({ trucks: 4, onTime: false, allOnTime: true, role: 'tail' })).toBe(0);
    expect(convoyShare({ trucks: 1, onTime: true, allOnTime: true, role: 'leader' })).toBe(0);
    const seg = [{ kind: 'drive' as const, leg: 'loaded' as const, start: 0, end: 100, fromKm: 0, toKm: 10 }, { kind: 'unloading' as const, leg: 'loaded' as const, start: 100, end: 120, fromKm: 10, toKm: 10 }];
    const slow = stretchSchedule(seg, 0, 240);
    expect(slow[1]!.end).toBe(240);
    expect(slow[0]!.end).toBe(200);
    const at = nextWeeklyDeparture(new Date('2027-07-21T10:00:00Z'));
    expect(at.toISOString()).toBe('2027-07-25T17:00:00.000Z'); // Sunday 20:00 in Sofia (summer time)
  });

  it('a column leaves together, arrives together and is paid by its size; the leader gets more', async () => {
    const { from, to } = await lane();
    const lead = await driver();
    const mate = await driver();
    const now = new Date();
    const { id } = await createConvoy(db(), lead.userId, { originCityId: from.id, destCityId: to.id, departInMin: 15, seats: 4 }, now);
    for (const p of [lead, mate]) {
      const load = await makeContract('Sofia', 'Plovdiv');
      await joinConvoy(db(), p.userId, id, { vehicleId: p.truck.id, contractId: load.id }, now);
    }
    expect(await code(joinConvoy(db(), mate.userId, id, { vehicleId: mate.truck.id, contractId: (await makeContract('Sofia', 'Plovdiv')).id }, now))).toBe('already');
    const [c] = await db().select().from(convoys).where(eq(convoys.id, id));
    await departConvoys(db(), c!.departAt);
    const members = await db().select().from(convoyMembers).where(eq(convoyMembers.convoyId, id));
    expect(members.every((m) => m.status === 'departed')).toBe(true);
    const trips = await db().select().from(deliveries).where(inArray(deliveries.id, members.map((m) => m.deliveryId!)));
    expect(new Set(trips.map((t) => t.etaAt.getTime())).size).toBe(1);
    expect(trips.every((t) => t.organizedConvoyId === id && t.convoyWith === null)).toBe(true);
    await arrive(trips.map((t) => t.id));
    const leadTrip = members.find((m) => m.userId === lead.userId)!.deliveryId!;
    const mateTrip = members.find((m) => m.userId === mate.userId)!.deliveryId!;
    const leadBonus = await bonusOf(lead.userId, leadTrip);
    const mateBonus = await bonusOf(mate.userId, mateTrip);
    expect(mateBonus).toBeTruthy();
    expect(leadBonus!.amountCents).toBeGreaterThan(mateBonus!.amountCents);
    const [done] = await db().select().from(convoys).where(eq(convoys.id, id));
    expect(done).toMatchObject({ status: 'arrived', trucks: 2 });
    const [stats] = await db().select().from(convoyStats).where(eq(convoyStats.userId, lead.userId));
    expect(stats).toMatchObject({ convoys: 1, led: 1, streak: 1 });
  });

  it('a truck that cannot take its load stays behind; friends-only and level rules; cancel frees the loads', async () => {
    const { from, to } = await lane();
    const lead = await driver();
    const stranger = await driver();
    const now = new Date();
    const friends = await createConvoy(db(), lead.userId, { originCityId: from.id, destCityId: to.id, departInMin: 30, seats: 3, access: 'friends' }, now);
    expect(await code(joinConvoy(db(), stranger.userId, friends.id, { vehicleId: stranger.truck.id, contractId: (await makeContract('Sofia', 'Plovdiv')).id }, now))).toBe('forbidden');
    await db().insert(friendships).values({ requesterId: lead.userId, addresseeId: stranger.userId, status: 'accepted' });
    expect(await code(joinConvoy(db(), stranger.userId, friends.id, { vehicleId: stranger.truck.id, contractId: (await makeContract('Sofia', 'Plovdiv')).id }, now))).toBe('ok');
    await cancelConvoy(db(), lead.userId, friends.id);
    expect((await db().select().from(convoys).where(eq(convoys.id, friends.id)))[0]!.status).toBe('cancelled');

    // A truck that is no longer in the start city stays behind.
    const shared = await createConvoy(db(), lead.userId, { originCityId: from.id, destCityId: to.id, departInMin: 15, seats: 3, sharedCargo: 'pallets', sharedTons: CONVOYS.sharedTons.min }, now);
    await joinConvoy(db(), stranger.userId, shared.id, { vehicleId: stranger.truck.id, contractId: null }, now);
    await db().update(vehicles).set({ cityId: to.id }).where(eq(vehicles.id, stranger.truck.id));
    const [c] = await db().select().from(convoys).where(eq(convoys.id, shared.id));
    await departConvoys(db(), c!.departAt);
    const [m] = await db().select().from(convoyMembers).where(and(eq(convoyMembers.convoyId, shared.id), eq(convoyMembers.userId, stranger.userId)));
    expect(m!.status).toBe('dropped');
    expect(m!.reason).toBeTruthy();

    const young = await driver(1);
    expect(await code(createConvoy(db(), young.userId, { originCityId: from.id, destCityId: to.id, departInMin: 15, seats: 2 }, now))).toBe('level_required');
    expect(await code(createConvoy(db(), lead.userId, { originCityId: from.id, destCityId: to.id, departInMin: 15, seats: 12 }, now))).toBe('too_many_seats');
  });

  it('a company convoy pays no contribution', async () => {
    const owner = await playerWithCompany('Sofia');
    const [org] = await db().select().from(organizations).where(eq(organizations.ownerId, owner.userId));
    await db().update(organizations).set({ recruitment: 'open', minJoinLevel: 1, contributionRate: 0.1 }).where(eq(organizations.id, org!.id));
    await db().update(users).set({ level: 3 }).where(eq(users.id, owner.userId));
    const mate = await driver();
    await joinCompany(db(), mate.userId, org!.id);
    const { from, to } = await lane();
    const now = new Date();
    const { id } = await createConvoy(db(), owner.userId, { kind: 'company', originCityId: from.id, destCityId: to.id, departInMin: 15, seats: 4 }, now);
    for (const p of [{ userId: owner.userId, truck: await truckOf(owner.userId) }, mate]) await joinConvoy(db(), p.userId, id, { vehicleId: p.truck.id, contractId: (await makeContract('Sofia', 'Plovdiv')).id }, now);
    const [c] = await db().select().from(convoys).where(eq(convoys.id, id));
    await departConvoys(db(), c!.departAt);
    const members = await db().select().from(convoyMembers).where(eq(convoyMembers.convoyId, id));
    expect(members.filter((m) => m.status === 'departed')).toHaveLength(2);
    await arrive(members.map((m) => m.deliveryId!));
    const contributions = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.category, 'company_contribution'), inArray(ledgerEntries.refId, members.map((m) => m.deliveryId!))));
    expect(contributions).toHaveLength(0);
  });
});
