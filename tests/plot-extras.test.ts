import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// As released (before the date these are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true, featureDate: () => new Date('2026-01-01T00:00:00Z') }));
import { memberBonuses } from '@/lib/game/company';
import { CREW_RULES } from '@/lib/game/crew';
import { BOOM, decorError, EXPANSIONS, isBoom, levelSpec, materialCostCents, PLOT, placementError, plotWidth } from '@/lib/game/plot';
import { closeDb } from '@/server/db/client';
import { companies, companyBuildings, companyBuilds, deliveries, drivers, orgVehicles, organizations, userBadges, users, vehicles } from '@/server/db/schema';
import { borrowOrgVehicle, buyOrgVehicle, returnOrgVehicle, sellOrgVehicle } from '@/server/game/company-fleet';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { sellVehicle } from '@/server/game/fleet';
import { joinCompany, leaveCompany, updateSettings } from '@/server/game/membership';
import { expandPlot, finishConstructions, orderMaterials, placeBuilding, placeDecor, plotView, removeDecor, startConstruction } from '@/server/game/plot';
import { closePoll, companyPollsView, createPoll, votePoll } from '@/server/game/polls';
import { approximateProvider } from '@/server/geo/routing';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const withMember = async (orgId: string, ownerId: string) => {
  await updateSettings(db(), ownerId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
  const m = await newPlayer();
  await joinCompany(db(), m.userId, orgId);
  return m;
};

describe('plot rules (v1.3 extras)', () => {
  it('the boom: the release week, then the first 7 days of every month (Sofia time)', () => {
    expect(isBoom(new Date('2026-12-10T12:00:00Z'))).toBe(false);
    expect(isBoom(new Date('2026-12-13T00:30:00+02:00'))).toBe(true);
    expect(isBoom(new Date('2026-12-20T22:00:00+02:00'))).toBe(true);
    expect(isBoom(new Date('2026-12-22T12:00:00Z'))).toBe(false);
    expect(isBoom(new Date('2027-01-07T21:30:00Z'))).toBe(true); // 23:30 on the 7th in Sofia
    expect(isBoom(new Date('2027-01-07T22:30:00Z'))).toBe(false); // already the 8th
    expect(materialCostCents({ cement: 10 }, false, true)).toBe(Math.round(10 * 180_00 * BOOM.priceFactor));
  });

  it('a wider plot after buying land; decorations and buildings keep apart', () => {
    expect(plotWidth(0)).toBe(PLOT.w);
    expect(plotWidth(9)).toBe(plotWidth(EXPANSIONS.length));
    expect(placementError('office', 15, 0, [])).toMatch(/извън/);
    expect(placementError('office', 15, 0, [], { plotW: plotWidth(1) })).toBeNull();
    expect(decorError('fountain', 1, 1, [{ type: 'office', x: 0, y: 0 }], [])).toMatch(/Офис/);
    expect(decorError('bench', 6, 8, [], [])).toMatch(/пътят/);
    expect(decorError('bench', 4, 1, [], [{ kind: 'tree', x: 4, y: 1 }])).toMatch(/Дърво/);
    expect(placementError('office', 1, 1, [], { decor: [{ kind: 'tree', x: 2, y: 2 }] })).toMatch(/Дърво/);
    expect(memberBonuses({ rest: 2 }).restCut).toBeCloseTo(0.3);
  });
});

describe('decorations, land and the boom', () => {
  it('decorations: лв. from the treasury, ТрансКоин from the buyer; removing pays nothing back', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().update(organizations).set({ treasuryCents: 10_000_00 }).where(eq(organizations.id, org.id));
    const bench = await placeDecor(db(), owner.userId, 'bench', 2, 2);
    expect((await orgOf(owner.userId)).treasuryCents).toBe(9_000_00);
    expect(await code(placeDecor(db(), owner.userId, 'tree', 2, 2))).toBe('bad_place');
    expect(await code(placeDecor(db(), owner.userId, 'fountain', 3, 3))).toBe('insufficient_coins');
    await db().update(users).set({ coins: 100 }).where(eq(users.id, owner.userId));
    await placeDecor(db(), owner.userId, 'fountain', 3, 3);
    expect((await db().select({ coins: users.coins }).from(users).where(eq(users.id, owner.userId)))[0]!.coins).toBe(40);
    expect((await plotView(db(), org.id))!.decor.map((d) => d.kind).sort()).toEqual(['bench', 'fountain']);
    // A building does not go over a decoration.
    expect(await code(placeBuilding(db(), owner.userId, 'office', 2, 1))).toBe('bad_place');
    await removeDecor(db(), owner.userId, bench.id);
    expect((await plotView(db(), org.id))!.decor).toHaveLength(1);
    expect((await orgOf(owner.userId)).treasuryCents).toBe(9_000_00);
    const member = await withMember(org.id, owner.userId);
    expect(await code(placeDecor(db(), member.userId, 'tree', 8, 8))).toBe('forbidden');
  });

  it('land is bought from the treasury at the company level it needs', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().update(organizations).set({ treasuryCents: 1_000_000_00 }).where(eq(organizations.id, org.id));
    expect(await code(expandPlot(db(), owner.userId))).toBe('company_level');
    await db().update(organizations).set({ companyLevel: EXPANSIONS[0].minCompanyLevel }).where(eq(organizations.id, org.id));
    expect(await expandPlot(db(), owner.userId)).toEqual({ expansions: 1 });
    expect((await orgOf(owner.userId)).treasuryCents).toBe(1_000_000_00 - EXPANSIONS[0].costCents);
    expect((await plotView(db(), org.id))!.plotW).toBe(plotWidth(1));
    expect(await code(expandPlot(db(), owner.userId))).toBe('company_level');
  });

  it('in the boom materials cost less and hauling them teaches more; the first building gives "Първа тухла"', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().update(organizations).set({ treasuryCents: 2_000_000_00 }).where(eq(organizations.id, org.id));
    const member = await withMember(org.id, owner.userId);
    const boom = new Date('2026-12-14T10:00:00+02:00');
    const build = await placeBuilding(db(), owner.userId, 'office', 1, 1, boom);
    const order = await orderMaterials(db(), owner.userId, build.id, boom, approximateProvider);
    expect(order.costCents).toBe(materialCostCents(levelSpec('office', 1).materials, false, true));
    // Everything arrives (the loads are not what this test is about), then the timer.
    await db().update(companyBuilds).set({ delivered: levelSpec('office', 1).materials }).where(eq(companyBuilds.id, build.id));
    const endsAt = await startConstruction(db(), owner.userId, build.id, boom);
    expect(await finishConstructions(db(), new Date(endsAt.getTime() + 1000))).toBe(1);
    for (const u of [owner.userId, member.userId]) {
      const badges = await db().select().from(userBadges).where(and(eq(userBadges.userId, u), eq(userBadges.badge, 'first-brick')));
      expect(badges).toHaveLength(1);
    }
  });
});

describe('rest stop', () => {
  it('drivers rest less after a trip that ends in the base city', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().update(organizations).set({ upgrades: { rest: 2 } }).where(eq(organizations.id, org.id));
    const account = await accountOf(owner.userId);
    const contract = await makeContract('Plovdiv', 'Sofia');
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account.id));
    await db().update(vehicles).set({ cityId: contract.originCityId }).where(eq(vehicles.id, truck!.id));
    const d = await acceptContract(db(), owner.userId, contract.id, truck!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account.id);
    const [done] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const [driver] = await db().select().from(drivers).where(eq(drivers.id, done!.driverId));
    const full = (CREW_RULES.restGameMin * 60_000) / Math.max(1, Number(process.env.GAME_TIME_SCALE ?? 1));
    expect(driver!.restedAt!.getTime() - done!.completedAt!.getTime()).toBeCloseTo(full * 0.7, -1);
  });
});

describe('company trucks', () => {
  it('bought from the treasury with a parking, borrowed by one member at a time, returned with their wear', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().update(organizations).set({ treasuryCents: 500_000_00 }).where(eq(organizations.id, org.id));
    expect(await code(buyOrgVehicle(db(), owner.userId, 'hemus-r12-box'))).toBe('no_parking');
    await db().update(organizations).set({ upgrades: { parking: 1 } }).where(eq(organizations.id, org.id));
    await db().insert(companyBuildings).values({ organizationId: org.id, type: 'parking', x: 8, y: 7, level: 1 }).onConflictDoNothing();
    expect(await code(buyOrgVehicle(db(), owner.userId, 'some-tractor'))).toBe('unknown_model');
    const ov = await buyOrgVehicle(db(), owner.userId, 'hemus-r12-box');
    await buyOrgVehicle(db(), owner.userId, 'sokol-courier');
    expect(await code(buyOrgVehicle(db(), owner.userId, 'sokol-courier'))).toBe('parking_full');

    const member = await withMember(org.id, owner.userId);
    const v = await borrowOrgVehicle(db(), member.userId, ov.id);
    expect(v.ownership).toBe('company');
    expect(await code(borrowOrgVehicle(db(), owner.userId, ov.id))).toBe('lent');
    expect(await code(sellOrgVehicle(db(), owner.userId, ov.id))).toBe('lent');
    expect(await code(sellVehicle(db(), member.userId, v.id))).toBe('company_truck');

    // Wear and kilometres go back with the truck.
    await db().update(vehicles).set({ condition: 80, odometerKm: 1234 }).where(eq(vehicles.id, v.id));
    await returnOrgVehicle(db(), member.userId, v.id);
    const [back] = await db().select().from(orgVehicles).where(eq(orgVehicles.id, ov.id));
    expect(back).toMatchObject({ lentTo: null, condition: 80, odometerKm: 1234 });
    expect((await db().select().from(vehicles).where(and(eq(vehicles.id, v.id), isNull(vehicles.soldAt)))).length).toBe(0);

    // Leaving the company gives it back.
    const again = await borrowOrgVehicle(db(), member.userId, ov.id);
    await leaveCompany(db(), member.userId);
    expect((await db().select().from(orgVehicles).where(eq(orgVehicles.id, ov.id)))[0]!.lentTo).toBeNull();
    expect((await db().select().from(vehicles).where(eq(vehicles.id, again.id)))[0]!.soldAt).not.toBeNull();

    const before = (await orgOf(owner.userId)).treasuryCents;
    const value = await sellOrgVehicle(db(), owner.userId, ov.id);
    expect((await orgOf(owner.userId)).treasuryCents).toBe(before + value);
  });
});

describe('polls', () => {
  it('one open poll; members vote once and may change it; the ranks with "Чат" close it', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    const member = await withMember(org.id, owner.userId);
    expect(await code(createPoll(db(), member.userId, { question: 'Какво строим?', options: ['Склад', 'Сервиз'], hours: 24 }))).toBe('forbidden');
    expect(await code(createPoll(db(), owner.userId, { question: 'Какво строим?', options: ['Склад', 'склад'], hours: 24 }))).toBe('duplicate_option');
    const poll = await createPoll(db(), owner.userId, { question: 'Какво строим?', options: ['Склад', 'Сервиз', ''], hours: 24 });
    expect(poll.options).toEqual(['Склад', 'Сервиз']);
    expect(await code(createPoll(db(), owner.userId, { question: 'Още една?', options: ['Да', 'Не'], hours: 6 }))).toBe('poll_open');
    await votePoll(db(), member.userId, poll.id, 0);
    await votePoll(db(), member.userId, poll.id, 1);
    await votePoll(db(), owner.userId, poll.id, 1);
    expect(await code(votePoll(db(), owner.userId, poll.id, 5))).toBe('bad_option');
    const outsider = await newPlayer();
    expect(await code(votePoll(db(), outsider.userId, poll.id, 0))).toBe('not_member');
    const [view] = await companyPollsView(db(), org.id, member.userId);
    expect(view).toMatchObject({ counts: [0, 2], total: 2, myVote: 1, open: true });
    await closePoll(db(), owner.userId, poll.id);
    expect(await code(votePoll(db(), member.userId, poll.id, 0))).toBe('poll_closed');
    expect((await companyPollsView(db(), org.id, member.userId))[0]!.open).toBe(false);
  });
});
