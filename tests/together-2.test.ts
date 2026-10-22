import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { ANNIVERSARY, anniversaryGiftCents, anniversaryYears, daysToAnniversary, isPerfectConvoy, PERFECT_CONVOY, STAFF_BUS } from '@/lib/game/community';
import { closeDb } from '@/server/db/client';
import { allianceInvites, allianceListings, cities, companies, deliveries, depots, laneRecords, ledgerEntries, organizations, treasuryEntries, userBadges, users, vehicles, warehouseStock } from '@/server/db/schema';
import { allianceMarketRange, buyAllianceListing, expireAllianceListings, listForAlliance } from '@/server/game/alliance-market';
import { createAlliance, dissolveAlliance, inviteToAlliance, respondAllianceInvite } from '@/server/game/alliances';
import { celebrateAnniversaries, laneRecordsView, recordLaneRun, setShowcase, showcaseOf, staffBus } from '@/server/game/community';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { joinCompany } from '@/server/game/membership';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (userId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(userId)).id)))[0]!;

describe('rules', () => {
  it('perfect convoy, anniversaries', () => {
    expect(isPerfectConvoy({ late: false, at: 0 }, { late: false, at: PERFECT_CONVOY.togetherMin * 60_000 })).toBe(true);
    expect(isPerfectConvoy({ late: false, at: 0 }, { late: false, at: PERFECT_CONVOY.togetherMin * 60_000 + 1 })).toBe(false);
    expect(isPerfectConvoy({ late: true, at: 0 }, { late: false, at: 0 })).toBe(false);
    const founded = new Date('2026-03-10T10:00:00Z');
    expect(anniversaryYears(founded, new Date('2027-03-10T12:00:00Z'))).toBe(1);
    expect(anniversaryYears(founded, new Date('2027-03-11T12:00:00Z'))).toBe(0);
    expect(anniversaryYears(founded, new Date('2026-03-10T12:00:00Z'))).toBe(0);
    expect(daysToAnniversary(founded, new Date('2027-03-01T12:00:00Z'))).toBe(9);
    expect(anniversaryGiftCents(20)).toBe(ANNIVERSARY.maxCents);
  });
});

describe('together on the road', () => {
  it('a perfect convoy pays both drivers', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const ca = await makeContract('Sofia', 'Plovdiv');
    const cb = await makeContract('Sofia', 'Plovdiv');
    const da = await acceptContract(db(), a.userId, ca.id, (await truckOf(a.userId)).id);
    const db2 = await acceptContract(db(), b.userId, cb.id, (await truckOf(b.userId)).id);
    const eta = new Date(Math.max(da.etaAt.getTime(), db2.etaAt.getTime()));
    await db().update(deliveries).set({ convoyWith: db2.id, etaAt: eta, nextEventAt: null }).where(eq(deliveries.id, da.id));
    await db().update(deliveries).set({ convoyWith: da.id, etaAt: new Date(eta.getTime() + 60_000), nextEventAt: null }).where(eq(deliveries.id, db2.id));
    await settleDueDeliveries(db(), new Date(eta.getTime() + 5 * 60_000));
    for (const [p, c] of [[a, ca], [b, cb]] as const) {
      const rows = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, (await accountOf(p.userId)).id), eq(ledgerEntries.category, 'convoy_perfect')));
      expect(rows.map((r) => r.amountCents)).toEqual([Math.round(c.rewardCents * PERFECT_CONVOY.bonusShare)]);
    }
  });

  it('lane records: a faster on-time run takes the record, a slower one does not', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const lane = { originCityId: (await makeContract('Varna', 'Burgas')).originCityId, destCityId: (await makeContract('Varna', 'Burgas')).destCityId };
    const at = new Date('2027-02-21T10:00:00Z');
    const run = (minutes: number) => [{ kind: 'loading', leg: 'loaded', start: 0, end: 30 * 60_000 }, { kind: 'drive', leg: 'loaded', start: 30 * 60_000, end: (30 + minutes) * 60_000 }];
    await db().transaction((tx) => recordLaneRun(tx, a.userId, { id: crypto.randomUUID(), schedule: run(200), loadedKm: 130 }, lane, false, at));
    expect(await db().transaction((tx) => recordLaneRun(tx, b.userId, { id: crypto.randomUUID(), schedule: run(220), loadedKm: 130 }, lane, false, at))).toBeNull();
    expect(await db().transaction((tx) => recordLaneRun(tx, b.userId, { id: crypto.randomUUID(), schedule: run(150), loadedKm: 130 }, lane, true, at))).toBeNull();
    expect((await db().transaction((tx) => recordLaneRun(tx, b.userId, { id: crypto.randomUUID(), schedule: run(180), loadedKm: 130 }, lane, false, at)))!.beaten).toBe(true);
    const [row] = await db().select().from(laneRecords).where(and(eq(laneRecords.month, '2027-02'), eq(laneRecords.originCityId, lane.originCityId), eq(laneRecords.destCityId, lane.destCityId)));
    expect(row!.userId).toBe(b.userId);
    expect(row!.minutes).toBe(180);
    expect((await laneRecordsView(db(), at, 50, b.userId)).length).toBe(1);
  });

  it('the staff bus brings a new member\'s truck to the base once; the first trip pays a bonus', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().update(organizations).set({ recruitment: 'open' }).where(eq(organizations.id, org.id));
    const m = await newPlayer('Plovdiv');
    expect(await joinCompany(db(), m.userId, org.id)).toBe('joined');
    const truck = await truckOf(m.userId);
    expect(await code(staffBus(db(), owner.userId, truck.id))).toBe('owner');
    const now = new Date();
    const { arrivesAt } = await staffBus(db(), m.userId, truck.id, now);
    expect(arrivesAt.getTime() - now.getTime()).toBe(STAFF_BUS.rideMs);
    expect((await db().select().from(vehicles).where(eq(vehicles.id, truck.id)))[0]!.cityId).toBe(org.hqCityId);
    expect(await code(staffBus(db(), m.userId, truck.id))).toBe('used');

    const c = await makeContract('Sofia', 'Plovdiv');
    await db().update(vehicles).set({ movingUntil: null }).where(eq(vehicles.id, truck.id));
    const d = await acceptContract(db(), m.userId, c.id, truck.id);
    await db().update(deliveries).set({ nextEventAt: null }).where(eq(deliveries.id, d.id));
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000));
    const rows = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, (await accountOf(m.userId)).id), eq(ledgerEntries.category, 'staff_bus_bonus')));
    expect(rows.map((r) => r.amountCents)).toEqual([Math.round(c.rewardCents * STAFF_BUS.firstTripShare)]);
  });

  it('a company anniversary: a gift into the treasury and a badge, once', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    const now = new Date();
    const founded = new Date(now);
    founded.setUTCFullYear(now.getUTCFullYear() - 2);
    await db().update(organizations).set({ foundedAt: founded }).where(eq(organizations.id, org.id));
    const years = anniversaryYears(founded, now);
    // 29 February is the only day this can miss.
    if (!years) return;
    expect(years).toBe(2);
    await celebrateAnniversaries(db(), now);
    await celebrateAnniversaries(db(), now);
    const entries = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, org.id), eq(treasuryEntries.category, 'anniversary')));
    expect(entries.map((e) => e.amountCents)).toEqual([anniversaryGiftCents(years)]);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, owner.userId), eq(userBadges.badge, ANNIVERSARY.badge)))).toHaveLength(1);
  });

  it('the profile showcase: only own trucks and badges', async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const truck = await truckOf(a.userId);
    await db().insert(userBadges).values({ userId: a.userId, badge: 'perfect-5' }).onConflictDoNothing();
    await setShowcase(db(), a.userId, { trucks: [truck.id], badges: ['perfect-5'] });
    expect(await code(setShowcase(db(), b.userId, { trucks: [truck.id], badges: [] }))).toBe('not_yours');
    expect(await code(setShowcase(db(), b.userId, { trucks: [], badges: ['perfect-5'] }))).toBe('not_yours');
    const s = await showcaseOf(db(), a.userId);
    expect(s.trucks.map((t) => t.id)).toEqual([truck.id]);
    expect(s.badges.map((x) => x.id)).toEqual(['perfect-5']);
    expect((await db().select().from(users).where(eq(users.id, a.userId)))[0]!.showcase.trucks).toEqual([truck.id]);
  });

  it('the alliance warehouse: list, buy into the own warehouse, unsold goods come back', async () => {
    const a = await playerWithCompany('Sofia');
    const b = await playerWithCompany('Sofia');
    const outsider = await playerWithCompany('Sofia');
    await createAlliance(db(), a.userId, `Склад ${Date.now() % 100000}`);
    await inviteToAlliance(db(), a.userId, (await orgOf(b.userId)).name);
    const [inv] = await db().select().from(allianceInvites).where(eq(allianceInvites.organizationId, (await orgOf(b.userId)).id));
    await respondAllianceInvite(db(), b.userId, inv!.id, true);
    const [depotA] = await db().select().from(depots).where(eq(depots.companyId, (await accountOf(a.userId)).id));
    const [depotB] = await db().select().from(depots).where(eq(depots.companyId, (await accountOf(b.userId)).id));
    await db().insert(warehouseStock).values({ depotId: depotA!.id, cargoType: 'pallets', tons: 20, costCents: 20 * 50_00 });

    expect(await code(listForAlliance(db(), a.userId, { depotId: depotA!.id, cargo: 'pallets', tons: 5, pricePerTonCents: 1 }))).toBe('bad_price');
    const [city] = await db().select().from(cities).where(eq(cities.id, depotA!.cityId));
    const range = allianceMarketRange(city!, 'pallets', new Date());
    const listing = await listForAlliance(db(), a.userId, { depotId: depotA!.id, cargo: 'pallets', tons: 5, pricePerTonCents: range.base });
    expect((await db().select().from(warehouseStock).where(eq(warehouseStock.depotId, depotA!.id)))[0]!.tons).toBe(15);
    expect(await code(buyAllianceListing(db(), outsider.userId, listing.id))).toBe('no_alliance');
    expect(await code(buyAllianceListing(db(), a.userId, listing.id))).toBe('own');
    const balanceA = (await accountOf(a.userId)).balanceCents;
    await buyAllianceListing(db(), b.userId, listing.id);
    expect((await db().select().from(warehouseStock).where(eq(warehouseStock.depotId, depotB!.id)))[0]!.tons).toBe(5);
    expect((await accountOf(a.userId)).balanceCents).toBe(balanceA + listing.priceCents);
    expect(await code(buyAllianceListing(db(), b.userId, listing.id))).toBe('not_found');

    const again = await listForAlliance(db(), a.userId, { depotId: depotA!.id, cargo: 'pallets', tons: 5, pricePerTonCents: range.base });
    await expireAllianceListings(db(), new Date(Date.now() + 100 * 3_600_000));
    expect((await db().select().from(allianceListings).where(eq(allianceListings.id, again.id)))[0]!.status).toBe('expired');
    expect((await db().select().from(warehouseStock).where(eq(warehouseStock.depotId, depotA!.id)))[0]!.tons).toBe(15);
    // Other test files count the alliances (weekly battles): this one goes away.
    await dissolveAlliance(db(), a.userId);
  });
});
