import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { BONUS_RULES, maxRanks } from '@/lib/game/company';
import { LEASE, leaseTerms, payoffCents } from '@/lib/game/leasing';
import { MULTISTOP, splitTons, stopMultiplier, stopPenaltyCents } from '@/lib/game/multistop';
import { isRecapTime, recapYear } from '@/lib/game/recap';
import { planTrip, type Segment } from '@/lib/game/schedule';
import { closeDb } from '@/server/db/client';
import { companies, companyMembers, companyRanks, ledgerEntries, organizations, treasuryEntries, users, vehicleLeases, vehicles } from '@/server/db/schema';
import { bonusRoomCents, payBonus } from '@/server/game/bonuses';
import { stopsOnTheWay, type Hub } from '@/server/game/contracts';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyVehicle, sellVehicle } from '@/server/game/fleet';
import { collectLeases, payOffLease } from '@/server/game/leasing';
import { createRank, decideApplication, joinCompany, updateRank, updateSettings } from '@/server/game/membership';
import { yearRecap } from '@/server/game/recap';
import { getRouteVia } from '@/server/geo/route-service';
import { approximateProvider } from '@/server/geo/routing';
import { cityByName, db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const fund = async (userId: string, cents: number) => {
  const a = await accountOf(userId);
  await db().update(companies).set({ balanceCents: a.balanceCents + cents }).where(eq(companies.id, a.id));
};

describe('groupage loads', () => {
  it('splits the load, pays per stop and charges a late drop on its share', () => {
    const parts = splitTons(20, 2, () => 0.5);
    expect(parts).toHaveLength(3);
    expect(parts.reduce((s, t) => s + t, 0)).toBeCloseTo(20, 5);
    expect(stopMultiplier(2)).toBeCloseTo(1 + 2 * MULTISTOP.stopBonusShare);
    expect(stopPenaltyCents(1000_00, 20, [{ tons: 5 }])).toBe(Math.round(1000_00 * 0.25 * MULTISTOP.latePenaltyShare));
    expect(stopPenaltyCents(1000_00, 20, [])).toBe(0);
  });

  it('the schedule unloads at each stop on the way', () => {
    const trip = planTrip({ startAt: 0, empty: null, loaded: { km: 600, durationS: 600 * 51, borderKms: [], stops: [{ km: 150, minutes: 30 }, { km: 400, minutes: 30 }] }, speedFactor: 1, timeScale: 1 });
    const drops = trip.segments.filter((s) => s.stop);
    expect(drops.map((s) => [s.kind, s.stop, Math.round(s.fromKm)])).toEqual([['unloading', 1, 150], ['unloading', 2, 400]]);
    expect(trip.segments.at(-1)!.kind).toBe('unloading');
    expect(trip.segments.at(-1)!.stop).toBeUndefined();
  });

  it('picks cities near the way, not detours', () => {
    const hub = (id: number, lat: number, lon: number): Hub => ({ id, countryCode: 'BG', lat, lon, population: 100_000, produces: new Set(), consumes: new Map([['pallets', 1]]) });
    const sofia = hub(1, 42.7, 23.32);
    const burgas = hub(2, 42.5, 27.47);
    const plovdiv = hub(3, 42.15, 24.75);
    const vidin = hub(4, 43.99, 22.88);
    const stops = stopsOnTheWay([sofia, burgas, plovdiv, vidin], sofia, burgas, 'pallets');
    expect(stops.map((h) => h.id)).toEqual([3]);
    expect(stopsOnTheWay([sofia, plovdiv, vidin], sofia, plovdiv, 'pallets')).toEqual([]);
  });

  it('a route through stops adds up its legs', async () => {
    const [a, b, c] = await Promise.all([cityByName('Sofia'), cityByName('Plovdiv'), cityByName('Burgas')]);
    const via = await getRouteVia(db(), a.id, [b.id], c.id, 'truck', approximateProvider);
    expect(via.profile).toBe(`truck:via:${b.id}`);
    expect(via.legKms).toHaveLength(2);
    expect(via.legKms[1]).toBeCloseTo(via.distanceKm, 5);
    expect(via.legKms[0]!).toBeGreaterThan(0);
    expect(via.legKms[0]!).toBeLessThan(via.distanceKm);
  });

  it('a late drop costs a penalty and the notification counts the stops', async () => {
    const p = await newPlayer('Sofia');
    const account = await accountOf(p.userId);
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account.id));
    const [a, b, c] = await Promise.all([cityByName('Sofia'), cityByName('Plovdiv'), cityByName('Burgas')]);
    const via = await getRouteVia(db(), a.id, [b.id], c.id, 'truck', approximateProvider);
    // The drop's window is one minute: it will be late; the destination is on time.
    const job = await makeContract('Sofia', 'Burgas', { routeId: via.id, distanceKm: via.distanceKm, weightTons: 1, stops: [{ cityId: b.id, km: via.legKms[0]!, tons: 0.4, windowMinutes: 1 }] });
    const d = await acceptContract(db(), p.userId, job.id, truck!.id);
    expect((d.schedule as Segment[]).some((s) => s.stop === 1)).toBe(true);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id);
    const [penalty] = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account.id), like(ledgerEntries.description, 'Закъснели спирки%')));
    expect(penalty!.amountCents).toBe(-Math.round(job.rewardCents * 0.4 * MULTISTOP.latePenaltyShare));
  });
});

describe('leasing', () => {
  it('terms: a down payment and instalments with interest; paying off early saves half the interest left', () => {
    const t = leaseTerms(100_000_00);
    expect(t.downCents).toBe(20_000_00);
    expect(t.weeklyCents).toBe(Math.ceil((80_000_00 * 1.12) / 10));
    expect(t.totalCents).toBeGreaterThan(100_000_00);
    const fresh = { priceCents: 100_000_00, downCents: t.downCents, weeklyCents: t.weeklyCents, payments: 10, paid: 0 };
    expect(payoffCents(fresh)).toBe(Math.round(80_000_00 + (t.weeklyCents * 10 - 80_000_00) / 2));
    expect(payoffCents({ ...fresh, paid: 10 })).toBe(0);
  });

  it('down payment now, weekly instalments, no selling until paid off', async () => {
    const p = await playerWithCompany('Sofia');
    await fund(p.userId, 30_000_00);
    const before = (await accountOf(p.userId)).balanceCents;
    const v = await buyVehicle(db(), p.userId, 'danubia-t440', p.hq.id, { lease: true });
    const terms = leaseTerms(98_000_00);
    expect((await accountOf(p.userId)).balanceCents).toBe(before - terms.downCents);
    expect(await code(sellVehicle(db(), p.userId, v.id))).toBe('leased');
    expect(await code(buyVehicle(db(), p.userId, 'sokol-courier', p.hq.id, { lease: true }))).toBe('lease_unavailable');

    const [lease] = await db().select().from(vehicleLeases).where(eq(vehicleLeases.vehicleId, v.id));
    await collectLeases(db(), new Date(lease!.nextDueAt.getTime() - 1000));
    expect((await db().select().from(vehicleLeases).where(eq(vehicleLeases.id, lease!.id)))[0]!.paid).toBe(0);
    await collectLeases(db(), new Date(lease!.nextDueAt.getTime() + 1000));
    const after = (await db().select().from(vehicleLeases).where(eq(vehicleLeases.id, lease!.id)))[0]!;
    expect(after.paid).toBe(1);
    expect(after.nextDueAt.getTime()).toBe(lease!.nextDueAt.getTime() + LEASE.periodDays * 86_400_000);
    // The same week is not taken twice.
    await collectLeases(db(), new Date(lease!.nextDueAt.getTime() + 2000));
    expect((await db().select().from(vehicleLeases).where(eq(vehicleLeases.id, lease!.id)))[0]!.paid).toBe(1);

    await fund(p.userId, 200_000_00);
    const cost = await payOffLease(db(), p.userId, lease!.id);
    expect(cost).toBe(payoffCents(after));
    expect((await db().select().from(vehicleLeases).where(eq(vehicleLeases.id, lease!.id)))[0]!.status).toBe('paid');
    expect(await code(sellVehicle(db(), p.userId, v.id))).toBe('ok');
  });

  it('two missed instalments: the truck goes back to the leasing company', async () => {
    const p = await playerWithCompany('Sofia');
    await fund(p.userId, 30_000_00);
    const v = await buyVehicle(db(), p.userId, 'danubia-t440', p.hq.id, { lease: true });
    const account = await accountOf(p.userId);
    await db().update(companies).set({ balanceCents: 0 }).where(eq(companies.id, account.id));
    const [lease] = await db().select().from(vehicleLeases).where(eq(vehicleLeases.vehicleId, v.id));
    const due1 = new Date(lease!.nextDueAt.getTime() + 1000);
    await collectLeases(db(), due1);
    expect((await db().select().from(vehicleLeases).where(eq(vehicleLeases.id, lease!.id)))[0]!.missed).toBe(1);
    await collectLeases(db(), new Date(due1.getTime() + LEASE.periodDays * 86_400_000));
    const [gone] = await db().select().from(vehicles).where(eq(vehicles.id, v.id));
    expect(gone!.status).toBe('repossessed');
    expect(gone!.soldAt).not.toBeNull();
    expect((await db().select().from(vehicleLeases).where(eq(vehicleLeases.id, lease!.id)))[0]!.status).toBe('repossessed');
  });
});

describe('company roles', () => {
  it('a recruiter decides applications without managing members; ready roles fit in', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    expect(maxRanks(1)).toBe(6);
    const rank = await createRank(db(), owner.userId, { name: 'Набирач', priority: 40, permissions: ['recruit'] });
    await createRank(db(), owner.userId, { name: 'Счетоводител', priority: 50, permissions: ['pay_bonuses'] });
    const recruiter = await newPlayer();
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    await joinCompany(db(), recruiter.userId, org.id);
    await db().update(companyMembers).set({ rankId: rank.id }).where(eq(companyMembers.userId, recruiter.userId));
    await updateSettings(db(), owner.userId, { recruitment: 'application', minJoinLevel: 1, contributionRate: 0.05 });
    const applicant = await newPlayer();
    expect(await joinCompany(db(), applicant.userId, org.id)).toBe('applied');
    const { companyApplications } = await import('@/server/db/schema');
    const [app] = await db().select().from(companyApplications).where(and(eq(companyApplications.userId, applicant.userId), eq(companyApplications.status, 'pending')));
    expect(await decideApplication(db(), recruiter.userId, app!.id, true)).toBe('accepted');
  });

  it('bonuses from the treasury: limits, one a day, not to oneself or a newcomer', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const driver = await newPlayer();
    await joinCompany(db(), driver.userId, org.id);
    await db().update(organizations).set({ treasuryCents: 40_000_00 }).where(eq(organizations.id, org.id));
    expect(await code(payBonus(db(), owner.userId, { userId: driver.userId, amount: 500 }, null))).toBe('too_new');
    await db().update(companyMembers).set({ joinedAt: new Date(Date.now() - 5 * 86_400_000) }).where(eq(companyMembers.userId, driver.userId));
    expect(await code(payBonus(db(), owner.userId, { userId: owner.userId, amount: 500 }, null))).toBe('self');
    expect(await code(payBonus(db(), driver.userId, { userId: owner.userId, amount: 500 }, null))).toBe('forbidden');
    const before = (await accountOf(driver.userId)).balanceCents;
    await payBonus(db(), owner.userId, { userId: driver.userId, amount: 2000, note: 'Браво за Бургас' }, null);
    expect((await accountOf(driver.userId)).balanceCents).toBe(before + 2000_00);
    expect((await orgOf(owner.userId)).treasuryCents).toBe(38_000_00);
    const [entry] = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, org.id), eq(treasuryEntries.category, 'member_bonus')));
    expect(entry!.description).toContain('Браво за Бургас');
    expect(await code(payBonus(db(), owner.userId, { userId: driver.userId, amount: 100 }, null))).toBe('bonus_today');
    // Daily room: a quarter of the treasury, at most the cap.
    expect(bonusRoomCents(38_000_00, 2_000_00)).toBe(Math.min(BONUS_RULES.companyDailyMaxCents, 40_000_00 * BONUS_RULES.companyDailyShare) - 2_000_00);
  });

  it('a rank edited before the release keeps recruiting with "members"', async () => {
    const owner = await playerWithCompany();
    const org = await orgOf(owner.userId);
    const [dispatcher] = await db().select().from(companyRanks).where(and(eq(companyRanks.companyId, org.id), eq(companyRanks.name, 'Диспечер')));
    expect(dispatcher!.permissions).toContain('recruit');
    await updateRank(db(), owner.userId, dispatcher!.id, { name: 'Диспечер', priority: dispatcher!.priority, permissions: ['manage_members', 'manage_tenders', 'recruit'] });
    expect((await db().select().from(companyRanks).where(eq(companyRanks.id, dispatcher!.id)))[0]!.permissions).toContain('recruit');
  });
});

describe('year recap', () => {
  it('opens from 15 December to the end of January, about the right year', () => {
    expect(isRecapTime(new Date('2026-12-15T10:00:00+02:00'))).toBe(true);
    expect(isRecapTime(new Date('2027-01-31T10:00:00+02:00'))).toBe(true);
    expect(isRecapTime(new Date('2027-02-01T10:00:00+02:00'))).toBe(false);
    expect(isRecapTime(new Date('2026-11-20T10:00:00+02:00'))).toBe(false);
    expect(recapYear(new Date('2026-12-20T10:00:00+02:00'))).toBe(2026);
    expect(recapYear(new Date('2027-01-10T10:00:00+02:00'))).toBe(2026);
  });

  it('adds up the year: trips, km, the longest trip and the favourite lane', async () => {
    const p = await newPlayer('Sofia');
    const account = await accountOf(p.userId);
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account.id));
    const job = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, job.id, truck!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id);
    const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric' }).format(d.etaAt));
    const r = (await yearRecap(db(), p.userId, year))!;
    expect(r.trips).toBe(1);
    expect(r.km).toBeGreaterThan(100);
    expect(r.longest!.to).toBe((await cityByName('Plovdiv')).nameBg);
    expect(r.lane!.trips).toBe(1);
    expect(r.countries).toBeGreaterThanOrEqual(1);
    expect((await yearRecap(db(), p.userId, year - 1))!.trips).toBe(0);
    const [u] = await db().select({ username: users.username }).from(users).where(eq(users.id, p.userId));
    expect(r.username).toBe(u!.username);
  });
});
