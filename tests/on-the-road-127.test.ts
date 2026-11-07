import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { CONVOY_HOUR, DUO, ESCORT, WAVE, isConvoyHour } from '@/lib/game/on-the-road';
import { closeDb } from '@/server/db/client';
import { chatMessages, cities, companies, contracts, deliveries, duos, escorts, inventoryItems, jobState, ledgerEntries, marketRumors, notifications, roadWaves, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDelivery } from '@/server/game/deliveries';
import { cafeCity, cafeHere, meetDelivered, pairDuos, signUpDuo, spreadRumors, wantItem, wantsView } from '@/server/game/meet';
import { channelFeed, postToChannel } from '@/server/game/messages';
import { convoyHourPoints, ratePartner, reliability, wave } from '@/server/game/on-the-road';
import { passView } from '@/server/game/season-pass';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());
beforeAll(() => {
  process.env.ROAD_EVENTS = 'off';
});

const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (userId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(userId)).id)))[0]!;
const accept = async (userId: string, contractId: string) => acceptContract(db(), userId, contractId, (await truckOf(userId)).id);
async function arrive(id: string) {
  const [row] = await db().select().from(deliveries).where(eq(deliveries.id, id));
  await db().transaction((tx) => settleDelivery(tx, id, new Date(row!.etaAt.getTime() + 60_000)));
}
const points = async (userId: string) => (await passView(db(), userId)).points;

describe('1.2.7 escort and ratings', () => {
  it('the load opens an escort run in the chat; another player escorts; both on time — bonuses, points and a rating', async () => {
    const lead = await newPlayer('Sofia');
    const pilot = await newPlayer('Sofia');
    const main = await makeContract('Sofia', 'Plovdiv', { rewardCents: 2_000_00, escort: true });
    const d1 = await accept(lead.userId, main.id);
    const [e] = await db().select().from(escorts).where(eq(escorts.mainContractId, main.id));
    expect(e).toMatchObject({ leaderId: lead.userId, status: 'open' });
    const [run] = await db().select().from(contracts).where(eq(contracts.id, e!.escortContractId!));
    expect(run!.escortFor).toBe(main.id);
    const [ad] = await db().select().from(chatMessages).where(eq(chatMessages.kind, 'escort')).orderBy(chatMessages.id);
    expect(ad).toBeTruthy();
    // The leader cannot escort their own load.
    await db().update(vehicles).set({ status: 'idle' }).where(eq(vehicles.id, (await truckOf(lead.userId)).id));
    await expect(accept(lead.userId, run!.id)).rejects.toThrow();
    await db().update(vehicles).set({ status: 'on_delivery' }).where(eq(vehicles.id, (await truckOf(lead.userId)).id));
    const before = await points(pilot.userId);
    const d2 = await accept(pilot.userId, run!.id);
    expect((await db().select().from(escorts).where(eq(escorts.id, e!.id)))[0]!.status).toBe('taken');
    await arrive(d1.id);
    await arrive(d2.id);
    expect((await db().select().from(escorts).where(eq(escorts.id, e!.id)))[0]!.status).toBe('done');
    const bonus = async (userId: string, key: string) => (await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, (await accountOf(userId)).id), eq(ledgerEntries.idempotencyKey, key))))[0]?.amountCents;
    expect(await bonus(lead.userId, `escort:${e!.id}:lead`)).toBe(Math.round(2_000_00 * ESCORT.mainBonus));
    expect(await bonus(pilot.userId, `escort:${e!.id}:escort`)).toBe(Math.round(2_000_00 * ESCORT.escortShare));
    expect((await points(pilot.userId)) - before).toBeGreaterThanOrEqual(ESCORT.passPoints);
    // Ratings: once each, only the two of them.
    await ratePartner(db(), lead.userId, e!.id, true);
    await expect(ratePartner(db(), lead.userId, e!.id, false)).rejects.toThrow();
    await expect(ratePartner(db(), (await newPlayer()).userId, e!.id, true)).rejects.toThrow();
    expect(await reliability(db(), pilot.userId)).toEqual({ good: 1, bad: 0 });
  });
});

describe('1.2.7 on the road', () => {
  it('two trucks on the same lane, opposite ways: „👋 Махни“; both wave — points and the private chat', async () => {
    const a = await newPlayer('Sofia');
    const b = await newPlayer('Plovdiv');
    await accept(a.userId, (await makeContract('Sofia', 'Plovdiv')).id);
    await accept(b.userId, (await makeContract('Plovdiv', 'Sofia')).id);
    const [w] = await db().select().from(roadWaves).where(eq(roadWaves.bId, a.userId));
    expect(w).toBeTruthy();
    const before = await points(a.userId);
    expect((await wave(db(), b.userId, w!.id)).both).toBe(false);
    expect((await wave(db(), a.userId, w!.id)).both).toBe(true);
    expect((await points(a.userId)) - before).toBe(WAVE.passPoints);
    const told = await db().select().from(notifications).where(and(eq(notifications.userId, a.userId), eq(notifications.href, `/game?chat=dm:${b.userId}`)));
    expect(told).toHaveLength(1);
  });

  it('the convoy hour: 20:00–20:30 Sofia, a convoy with another company — pass points ×2', async () => {
    expect(isConvoyHour(20, 10)).toBe(true);
    expect(isConvoyHour(20, 45)).toBe(false);
    expect(isConvoyHour(19, 10)).toBe(false);
    const p = await newPlayer();
    const at = new Date('2026-12-05T20:10:00+02:00');
    const trip = { startedAt: at, organizedConvoyId: '00000000-0000-0000-0000-000000000001', convoyWith: null } as never;
    expect(await db().transaction((tx) => convoyHourPoints(tx, p.userId, trip, 100, at))).toBe(100 * (CONVOY_HOUR.multiplier - 1));
    const late = { startedAt: new Date('2026-12-05T21:10:00+02:00'), organizedConvoyId: 'x', convoyWith: null } as never;
    expect(await db().transaction((tx) => convoyHourPoints(tx, p.userId, late, 100, at))).toBe(0);
  });

  it('the café: the city of a standing truck, who is there, a chat of its own', async () => {
    const a = await newPlayer('Varna');
    const b = await newPlayer('Varna');
    // The latest seen are shown first (12 at most): the two of them were just in the game.
    await db().update(users).set({ lastSeenAt: new Date() }).where(inArray(users.id, [a.userId, b.userId]));
    const city = await cafeCity(db(), a.userId);
    const [varna] = await db().select().from(cities).where(eq(cities.id, city!.id));
    expect(varna!.name).toBe('Varna');
    const here = (await cafeHere(db(), city!.id)).map((h) => h.id);
    expect(here).toEqual(expect.arrayContaining([a.userId, b.userId]));
    await postToChannel(db(), b.userId, `city:${city!.id}`, 'Някой за кафе на изхода на Варна?');
    const feed = await channelFeed(db(), `city:${city!.id}`);
    expect(feed.at(-1)!.body).toContain('кафе');
    expect((await channelFeed(db(), 'global')).some((m) => m.body?.includes('изхода на Варна'))).toBe(false);
  });
});

describe('1.2.7 meeting', () => {
  it('„Търся“: the ones with a spare are told; they see it under „Давам“', async () => {
    const seeker = await newPlayer();
    const owner = await newPlayer();
    await db().insert(inventoryItems).values({ userId: owner.userId, itemId: 'thermos', qty: 3 }).onConflictDoNothing();
    await wantItem(db(), seeker.userId, 'thermos', true);
    const told = await db().select().from(notifications).where(and(eq(notifications.userId, owner.userId), eq(notifications.href, `/game?chat=dm:${seeker.userId}`)));
    expect(told).toHaveLength(1);
    expect((await wantsView(db(), seeker.userId)).wants[0]!.owners.map((o) => o.id)).toContain(owner.userId);
    expect((await wantsView(db(), owner.userId)).canGive.some((g) => g.userId === seeker.userId)).toBe(true);
    await expect(wantItem(db(), seeker.userId, 'no_such_item', true)).rejects.toThrow();
  });

  it('rumours: three about tomorrow, one true; the true one pays more on its day', async () => {
    const evening = new Date('2031-07-07T19:00:00+03:00');
    await db().delete(jobState).where(eq(jobState.key, 'rumors:2031-07-08'));
    await spreadRumors(db(), evening, () => 0.1);
    const rows = await db().select().from(marketRumors).where(eq(marketRumors.day, '2031-07-08'));
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.real)).toHaveLength(1);
    const real = rows.find((r) => r.real)!;
    const p = await newPlayer();
    const co = await accountOf(p.userId);
    const day = new Date('2031-07-08T12:00:00+03:00');
    const paid = await db().transaction((tx) => meetDelivered(tx, p.userId, co.id, { id: crypto.randomUUID() }, { cargoType: real.cargo, rewardCents: 1_000_00 }, real.country, false, day));
    expect(paid).toBe(30_000);
    const none = await db().transaction((tx) => meetDelivered(tx, p.userId, co.id, { id: crypto.randomUUID() }, { cargoType: real.cargo, rewardCents: 1_000_00 }, real.country, true, day));
    expect(none).toBe(0);
  });

  it('the duo of the week: two sign-ups become a pair; their deliveries reach the goal together', async () => {
    const at = new Date('2031-09-01T13:00:00+03:00'); // a Monday after noon
    const a = await newPlayer();
    const b = await newPlayer();
    await signUpDuo(db(), a.userId, at);
    await signUpDuo(db(), b.userId, at);
    expect(await pairDuos(db(), at, () => 0.5)).toBeGreaterThanOrEqual(1);
    const [d] = await db().select().from(duos).where(eq(duos.aId, a.userId));
    const pair = d ?? (await db().select().from(duos).where(eq(duos.bId, a.userId)))[0]!;
    expect([pair.aId, pair.bId].sort()).toEqual([a.userId, b.userId].sort());
    await expect(signUpDuo(db(), a.userId, at)).rejects.toThrow();
    const co = await accountOf(a.userId);
    const before = (await passView(db(), b.userId, at)).points;
    for (let i = 0; i < DUO.target; i++) await db().transaction((tx) => meetDelivered(tx, i % 2 ? a.userId : b.userId, co.id, { id: crypto.randomUUID() }, { cargoType: 'pallets', rewardCents: 0 }, 'BG', false, at));
    const [done] = await db().select().from(duos).where(eq(duos.id, pair.id));
    expect(done!.doneAt).not.toBeNull();
    expect((await passView(db(), b.userId, at)).points - before).toBe(DUO.passPoints);
  });
});
