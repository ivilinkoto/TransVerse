import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { ACADEMY, ALLIANCE, FUEL_STATION, fuelDiscount } from '@/lib/game/alliances';
import { periodWindow } from '@/lib/game/missions';
import { closeDb } from '@/server/db/client';
import { allianceInvites, allianceWeeks, companyContracts, organizations, treasuryEntries, users } from '@/server/db/schema';
import { allianceMessages, allianceOf, clientsOf, createAlliance, enrolAcademy, fuelStationAt, inviteToAlliance, leaveAlliance, offerCompanyContract, payCompanyContract, postAllianceMessage, recordAcademyCourse, recordAllianceDelivery, respondAllianceInvite, respondCompanyContract, runAlliances } from '@/server/game/alliances';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { joinCompany } from '@/server/game/membership';
import { openContracts } from '@/server/game/contracts';
import { companies, vehicles } from '@/server/db/schema';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;

describe('alliances', () => {
  it('created, joined by invitation, a shared board, a weekly goal paid to every company', async () => {
    const a = await playerWithCompany('Sofia');
    const b = await playerWithCompany('Sofia');
    const orgA = await orgOf(a.userId);
    const orgB = await orgOf(b.userId);
    const al = await createAlliance(db(), a.userId, `Балкан ${Date.now() % 100000}`);
    expect(await code(createAlliance(db(), a.userId, 'Още един'))).toBe('in_alliance');
    await inviteToAlliance(db(), a.userId, orgB.name);
    const [inv] = await db().select().from(allianceInvites).where(eq(allianceInvites.organizationId, orgB.id));
    await respondAllianceInvite(db(), b.userId, inv!.id, true);
    expect((await allianceOf(db(), orgB.id))!.members).toHaveLength(2);

    await postAllianceMessage(db(), b.userId, 'Здравейте, съюзници!');
    expect((await allianceMessages(db(), al.id)).map((x) => x.body)).toContain('Здравейте, съюзници!');

    const now = new Date();
    await db().transaction((tx) => recordAllianceDelivery(tx, orgA.id, ALLIANCE.goalTonsPerCompany * 2, now));
    const week = periodWindow('weekly', now);
    await db().update(allianceWeeks).set({ endsAt: new Date(now.getTime() - 1000) }).where(and(eq(allianceWeeks.allianceId, al.id), eq(allianceWeeks.weekKey, week.key)));
    await runAlliances(db(), now);
    const paid = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.category, 'alliance'), eq(treasuryEntries.refId, al.id)));
    expect(paid.map((p) => p.organizationId).sort()).toEqual([orgA.id, orgB.id].sort());

    await leaveAlliance(db(), b.userId);
    expect((await allianceOf(db(), orgA.id))!.members).toHaveLength(1);
  });
});

describe('hauling contracts between companies', () => {
  it('the hauler takes the client\'s members-only loads and gets its share', async () => {
    const client = await playerWithCompany('Sofia');
    const hauler = await playerWithCompany('Sofia');
    const orgC = await orgOf(client.userId);
    const orgH = await orgOf(hauler.userId);
    await db().update(organizations).set({ treasuryCents: 100_000_00 }).where(eq(organizations.id, orgC.id));
    const c = await offerCompanyContract(db(), client.userId, orgH.name, 20);
    await respondCompanyContract(db(), hauler.userId, c.id, true);
    expect(await clientsOf(db(), orgH.id)).toEqual([orgC.id]);

    const load = await makeContract('Sofia', 'Plovdiv', { branchOrgId: orgC.id });
    const seen = await openContracts(db(), { originCityId: load.originCityId, limit: 500, memberOfCompanyId: orgH.id, withContracts: true });
    expect(seen.some((x) => x.id === load.id)).toBe(true);
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, hauler.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    expect(await code(acceptContract(db(), hauler.userId, load.id, truck!.id))).toBe('ok');

    const cents = await db().transaction((tx) => payCompanyContract(tx, orgC.id, orgH.id, '00000000-0000-4000-8000-0000000000aa', 50_000, 5, new Date()));
    expect(cents).toBe(10_000);
    const [row] = await db().select().from(companyContracts).where(eq(companyContracts.id, c.id));
    expect(row!.loads).toBe(1);
    expect((await orgOf(hauler.userId)).treasuryCents - orgH.treasuryCents).toBe(10_000);
  });
});

describe('academy and fuel station', () => {
  it('three courses finish the academy; the station discounts members and earns on others', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().update(users).set({ level: 12 }).where(eq(users.id, owner.userId));
    await db().update(organizations).set({ recruitment: 'open', minJoinLevel: 1 }).where(eq(organizations.id, org.id));
    const student = await newPlayer('Sofia');
    await joinCompany(db(), student.userId, org.id);
    await enrolAcademy(db(), student.userId, owner.userId);
    const xp0 = (await db().select().from(users).where(eq(users.id, student.userId)))[0]!.xp;
    for (let i = 0; i < ACADEMY.courses; i++) await db().transaction((tx) => recordAcademyCourse(tx, student.userId, { onTime: true, loadedKm: ACADEMY.minKm + 1 }, new Date()));
    expect((await db().select().from(users).where(eq(users.id, student.userId)))[0]!.xp - xp0).toBe(ACADEMY.studentXp);
    const academy = await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, org.id), eq(treasuryEntries.category, 'academy')));
    expect(academy).toHaveLength(1);

    expect(fuelDiscount(2)).toBe(FUEL_STATION.discount[2]);
    await db().update(organizations).set({ upgrades: sql`${organizations.upgrades} || '{"fuel": 2}'::jsonb` }).where(eq(organizations.id, org.id));
    const mine = await fuelStationAt(db(), org.hqCityId, owner.userId, new Date());
    expect(mine).toMatchObject({ member: true, discount: FUEL_STATION.discount[2] });
    const outsider = await newPlayer('Sofia');
    const theirs = await fuelStationAt(db(), org.hqCityId, outsider.userId, new Date());
    expect(theirs?.member).toBe(false);
  });
});

describe('alliance chat tab and dissolving', () => {
  it('the alliance chat feeds the dock; the leader dissolves the alliance', async () => {
    const { allianceFeed, dissolveAlliance, playerAlliance } = await import('@/server/game/alliances');
    const a = await playerWithCompany('Sofia');
    const b = await playerWithCompany('Sofia');
    const orgB = await orgOf(b.userId);
    const al = await createAlliance(db(), a.userId, `Тракия ${Date.now() % 100000}`);
    await inviteToAlliance(db(), a.userId, orgB.name);
    // No company is in an alliance before it accepts the invitation.
    expect(await allianceOf(db(), orgB.id)).toBeNull();
    const [inv] = await db().select().from(allianceInvites).where(and(eq(allianceInvites.organizationId, orgB.id), eq(allianceInvites.status, 'pending')));
    await respondAllianceInvite(db(), b.userId, inv!.id, true);
    await postAllianceMessage(db(), b.userId, 'В чата!');
    expect((await playerAlliance(db(), a.userId))!.id).toBe(al.id);
    expect((await allianceFeed(db(), al.id)).map((m) => m.body)).toContain('В чата!');
    expect(await code(dissolveAlliance(db(), b.userId))).toBe('not_leader');
    await dissolveAlliance(db(), a.userId);
    expect(await allianceOf(db(), orgB.id)).toBeNull();
    expect(await allianceFeed(db(), al.id)).toEqual([]);
  });
});
