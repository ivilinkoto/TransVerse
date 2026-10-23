import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { ALLIANCE_HALL, fuelDiscount, hallBonusShare, hallNextTons } from '@/lib/game/alliances';
import { closeDb } from '@/server/db/client';
import { allianceInvites, alliances, companies, deliveries, ledgerEntries, organizations, vehicles } from '@/server/db/schema';
import { runCommand } from '@/server/discord/commands';
import { allianceBases, allianceHall, allianceHallBonus, createAlliance, dissolveAlliance, fuelStationAt, inviteToAlliance, recordHallDelivery, respondAllianceInvite } from '@/server/game/alliances';
import { acceptContract } from '@/server/game/deliveries';
import { alliesOf, worldSnapshot } from '@/server/game/world-map';
import { db, makeContract, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truckOf = async (userId: string) => (await db().select().from(vehicles).where(eq(vehicles.companyId, (await accountOf(userId)).id)))[0]!;

/** Two companies (Sofia and Plovdiv) in one alliance; the first leads it. */
async function pair() {
  const a = await playerWithCompany('Sofia');
  const b = await playerWithCompany('Plovdiv');
  const al = await createAlliance(db(), a.userId, `Тест ${Date.now() % 1_000_000}`);
  await inviteToAlliance(db(), a.userId, (await orgOf(b.userId)).name);
  const [inv] = await db().select().from(allianceInvites).where(eq(allianceInvites.organizationId, (await orgOf(b.userId)).id));
  await respondAllianceInvite(db(), b.userId, inv!.id, true);
  return { a, b, al };
}

describe('the alliance hall rules', () => {
  it('levels need more tonnes; each adds a bonus', () => {
    expect(hallNextTons(0)).toBe(ALLIANCE_HALL.tons[0]);
    expect(hallNextTons(ALLIANCE_HALL.tons.length)).toBeNull();
    expect(hallBonusShare(2)).toBeCloseTo(0.02);
    expect(hallBonusShare(9)).toBeCloseTo(ALLIANCE_HALL.tons.length * ALLIANCE_HALL.bonusPerLevel);
  });
});

describe('together in the alliance', () => {
  it('allies: convoy, help, the map, the fuel card, the hall and /съюз', async () => {
    const { a, b, al } = await pair();
    expect((await alliesOf(db(), a.userId)).has(b.userId)).toBe(true);
    expect((await alliesOf(db(), a.userId)).has(a.userId)).toBe(false);

    // Convoy: the ally leaves on the same lane a moment later and joins.
    const c1 = await makeContract('Sofia', 'Pleven');
    const c2 = await makeContract('Sofia', 'Pleven');
    const d1 = await acceptContract(db(), a.userId, c1.id, (await truckOf(a.userId)).id);
    await db().update(vehicles).set({ cityId: c2.originCityId }).where(eq(vehicles.id, (await truckOf(b.userId)).id));
    const d2 = await acceptContract(db(), b.userId, c2.id, (await truckOf(b.userId)).id);
    expect((await db().select().from(deliveries).where(eq(deliveries.id, d2.id)))[0]!.convoyWith).toBe(d1.id);
    // The map: the ally's trip can be helped on the road.
    const world = await worldSnapshot(db(), new Date(), b.userId);
    expect(world.trucks.find((t) => t.delivery?.deliveryId === d1.id)).toBeTruthy();

    // Bases of the alliance on the map.
    const bases = await allianceBases(db(), b.userId);
    expect(bases.map((x) => x.own).sort()).toEqual([false, true]);

    // Fuel card: the leader company's station in Sofia gives the ally the members' discount.
    const orgA = await orgOf(a.userId);
    await db().update(organizations).set({ upgrades: { ...orgA.upgrades, fuel: 2 } }).where(eq(organizations.id, orgA.id));
    const station = await fuelStationAt(db(), orgA.hqCityId, b.userId, new Date());
    expect(station).toEqual({ orgId: orgA.id, member: true, discount: fuelDiscount(2) });

    // The hall stands in the leader's base city: materials there build it.
    const orgB = await orgOf(b.userId);
    expect(await db().transaction((tx) => recordHallDelivery(tx, b.userId, orgB.id, { cargoType: 'pallets', destCityId: orgB.hqCityId, tons: 50 }, new Date()))).toBeNull();
    expect(await db().transaction((tx) => recordHallDelivery(tx, b.userId, orgB.id, { cargoType: 'liquid', destCityId: orgA.hqCityId, tons: 50 }, new Date()))).toBeNull();
    const up = await db().transaction((tx) => recordHallDelivery(tx, b.userId, orgB.id, { cargoType: 'steel', destCityId: orgA.hqCityId, tons: ALLIANCE_HALL.tons[0] + 30 }, new Date()));
    expect(up).toEqual({ level: 1, tons: 30 });
    expect((await allianceHall(db(), al.id))!.level).toBe(1);
    const accB = await accountOf(b.userId);
    const fake = crypto.randomUUID();
    const bonus = await db().transaction((tx) => allianceHallBonus(tx, b.userId, orgB.id, { id: fake, companyId: accB.id }, 100_000, new Date()));
    expect(bonus).toBe(Math.round(100_000 * hallBonusShare(1)));
    expect(await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, accB.id), eq(ledgerEntries.category, 'alliance_hall_bonus')))).toHaveLength(1);

    // /съюз
    const [row] = await db().select().from(alliances).where(eq(alliances.id, al.id));
    const reply = await runCommand(db(), { name: 'съюз', options: { име: row!.name }, discordUserId: 'nobody' }, new Date());
    expect(reply.embeds![0]!.title).toContain(row!.name);
    expect(JSON.stringify(reply.embeds![0]!.fields)).toContain('ниво 1');

    // Other test files count the alliances (weekly battles): this one goes away.
    await dissolveAlliance(db(), a.userId);
  });
});
