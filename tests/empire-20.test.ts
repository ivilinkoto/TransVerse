import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { ECONOMY } from '@/lib/game/economy';
import { HOLDING, LEGACY, legacyShare } from '@/lib/game/empire';
import { closeDb } from '@/server/db/client';
import { cities, companies, deliveries, depots, holdingMembers, ledgerEntries, legacyRuns, organizations, territories, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { postTreasury } from '@/server/game/finance';
import { foundHolding, holdingNetwork, holdingOf, inviteToHolding, leaveHolding, respondHoldingInvite } from '@/server/game/holdings';
import { legacyBlockers, startNewCareer } from '@/server/game/legacy';
import { membershipOf } from '@/server/game/membership';
import { settleTerritories, territoriesOf } from '@/server/game/territories';
import { cityByName, db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const orgOf = async (userId: string) => (await membershipOf(db(), userId))!.company;
const fund = (orgId: string, cents: number) => db().transaction((tx) => postTreasury(tx, orgId, [{ category: 'admin_adjustment', amountCents: cents, description: 'test', idempotencyKey: `test-fund:${orgId}:${cents}` }]));

/** One delivery by the player from `from` to `to`, settled on arrival. */
async function deliver(userId: string, from: string, to: string, tons: number, at?: Date) {
  const c = await makeContract(from, to, { weightTons: tons, windowMinutes: 7 * 24 * 60 });
  const [account] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [truck] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, account!.id), eq(vehicles.status, 'idle')));
  await db().update(vehicles).set({ cityId: c.originCityId }).where(eq(vehicles.id, truck!.id));
  const d = await acceptContract(db(), userId, c.id, truck!.id);
  await settleDueDeliveries(db(), at ?? new Date(d.etaAt.getTime() + 1000), account!.id);
  return { account: account!, deliveryId: d.id };
}

describe('holdings', () => {
  it('a company of level 6 founds one from its treasury, invites, and the network pays', async () => {
    const a = await playerWithCompany('Sofia');
    const b = await playerWithCompany('Varna');
    const orgA = await orgOf(a.userId);
    const orgB = await orgOf(b.userId);
    expect(await code(foundHolding(db(), a.userId, 'Тест Холдинг'))).toBe('level');
    await db().update(organizations).set({ companyLevel: HOLDING.minCompanyLevel }).where(eq(organizations.id, orgA.id));
    expect(await code(foundHolding(db(), a.userId, 'Тест Холдинг'))).toBe('insufficient_treasury');
    await fund(orgA.id, HOLDING.foundCents);
    const h = await foundHolding(db(), a.userId, `Холдинг ${a.username}`);
    expect((await orgOf(a.userId)).treasuryCents).toBe(0);
    const inv = await inviteToHolding(db(), a.userId, orgB.name);
    await respondHoldingInvite(db(), b.userId, inv.id, true);
    const view = await holdingOf(db(), orgB.id);
    expect(view!.companies.map((c) => c.id)).toEqual([orgA.id, orgB.id]);
    expect((await holdingNetwork(db(), h.id)).has(orgA.hqCityId)).toBe(true);
    // A load from Varna to Sofia (the parent's base): the subsidiary's driver gets the network bonus.
    const { deliveryId } = await deliver(b.userId, 'Varna', 'Sofia', 5);
    const [bonus] = await db().select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, `delivery:${deliveryId}:holding`));
    expect(bonus?.amountCents ?? 0).toBeGreaterThan(0);
    // Not within a week of joining; the parent may let it go.
    expect(await code(leaveHolding(db(), b.userId))).toBe('too_soon');
    expect(await code(leaveHolding(db(), a.userId))).toBe('has_subsidiaries');
    await leaveHolding(db(), a.userId, orgB.id);
    expect(await db().select().from(holdingMembers).where(eq(holdingMembers.organizationId, orgB.id))).toEqual([]);
  });
});

describe('territories', () => {
  it('last week’s best company of a region holds it this week, once', async () => {
    const p = await playerWithCompany('Sofia');
    const org = await orgOf(p.userId);
    const varna = await cityByName('Varna');
    // Five loads into the Varna region, put in a past week.
    const monday = new Date('2025-05-19T10:00:00Z');
    for (let i = 0; i < 5; i++) {
      const { deliveryId } = await deliver(p.userId, 'Sofia', 'Varna', 7);
      await db().update(deliveries).set({ completedAt: new Date(`2025-05-1${3 + (i % 3)}T10:00:00Z`) }).where(eq(deliveries.id, deliveryId));
    }
    const r = await settleTerritories(db(), monday);
    expect(r!.regions).toBeGreaterThan(0);
    const held = await territoriesOf(db(), org.id, monday);
    expect(held.map((h) => h.region)).toContain(varna.region);
    expect(held.find((h) => h.region === varna.region)!.regionBg).toBe(varna.regionBg);
    expect(await settleTerritories(db(), monday)).toBeNull();
    const [row] = await db().select().from(territories).where(and(eq(territories.organizationId, org.id), eq(territories.region, varna.region!)));
    expect(row!.tons).toBeGreaterThanOrEqual(30);
    void cities;
  });
});

describe('legacy (New Game+)', () => {
  it('from level 25 the career starts over for a star that pays on every load', async () => {
    const p = await newPlayer('Plovdiv');
    expect((await legacyBlockers(db(), p.userId))[0]).toMatch(/25/);
    await db().update(users).set({ level: LEGACY.minLevel, xp: 999_999 }).where(eq(users.id, p.userId));
    expect(await legacyBlockers(db(), p.userId)).toEqual([]);
    const sofia = await cityByName('Sofia');
    const [before] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const { star } = await startNewCareer(db(), p.userId, sofia.id);
    expect(star).toBe(1);
    const [u] = await db().select().from(users).where(eq(users.id, p.userId));
    expect([u!.level, u!.xp, u!.legacyStars]).toEqual([1, 0, 1]);
    const [after] = await db().select().from(companies).where(eq(companies.id, before!.id));
    expect(after!.balanceCents).toBe(ECONOMY.startingBalanceCents);
    expect(after!.hqCityId).toBe(sofia.id);
    const fleet = await db().select().from(vehicles).where(and(eq(vehicles.companyId, before!.id), eq(vehicles.status, 'idle')));
    expect(fleet).toHaveLength(1);
    expect(fleet[0]!.ownership).toBe('rented');
    expect(await db().select().from(depots).where(eq(depots.companyId, before!.id))).toEqual([]);
    expect(await db().select().from(legacyRuns).where(eq(legacyRuns.userId, p.userId))).toHaveLength(1);
    // Not again so soon.
    await db().update(users).set({ level: LEGACY.minLevel }).where(eq(users.id, p.userId));
    expect(await code(startNewCareer(db(), p.userId, sofia.id))).toBe('legacy_blocked');
    // The star pays on the next load.
    const { deliveryId } = await deliver(p.userId, 'Sofia', 'Plovdiv', 3);
    const [bonus] = await db().select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, `delivery:${deliveryId}:legacy`));
    expect(bonus?.amountCents ?? 0).toBeGreaterThan(0);
    expect(legacyShare(9)).toBeCloseTo(LEGACY.maxStars * LEGACY.bonusPerStar);
  });

  it('an owner of a company must hand it over first', async () => {
    const p = await playerWithCompany('Sofia');
    await db().update(users).set({ level: LEGACY.minLevel }).where(eq(users.id, p.userId));
    expect((await legacyBlockers(db(), p.userId)).some((b) => /собствеността/.test(b))).toBe(true);
  });
});
