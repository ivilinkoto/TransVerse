import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { powerUnitModel } from '@/lib/game/catalog';
import { LEGEND, LEGEND_BADGE, legendTier, legendTiersCrossed, MUSEUM, SCRAP } from '@/lib/game/heritage';
import { closeDb } from '@/server/db/client';
import { companies, ledgerEntries, museumExhibits, organizations, userBadges, users, vehicles } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { donateToMuseum, museumOf, scrapVehicle, repairWithPart } from '@/server/game/heritage';
import { membershipOf } from '@/server/game/membership';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;
const ownTruck = async (userId: string) => {
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
  await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, truck!.id));
  return { acc: acc!, truck: { ...truck!, ownership: 'owned' } };
};

describe('rules', () => {
  it('legend tiers', () => {
    expect(legendTier(99_999)).toBe(0);
    expect(legendTier(100_000)).toBe(1);
    expect(legendTier(600_000)).toBe(3);
    expect(legendTiersCrossed(90_000, 260_000).map((t) => t.tier)).toEqual([1, 2]);
    expect(legendTiersCrossed(100_000, 120_000)).toEqual([]);
  });
});

describe('v1.6 heritage', () => {
  it('a truck becomes a legend on the trip that passes 100 000 km — coins and the badge once', async () => {
    const p = await newPlayer();
    const { acc, truck } = await ownTruck(p.userId);
    await db().update(vehicles).set({ odometerKm: LEGEND[0].km - 50 }).where(eq(vehicles.id, truck.id));
    const before = await coins(p.userId);
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, truck.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc.id);
    expect(await coins(p.userId)).toBe(before + LEGEND[0].coins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, LEGEND_BADGE)))).toHaveLength(1);
  });

  it('the scrapyard gives a tenth and spare parts; a part repairs another truck', async () => {
    const p = await newPlayer();
    const { acc, truck } = await ownTruck(p.userId);
    const { id: _id, ...rest } = truck;
    const [second] = await db().insert(vehicles).values({ ...rest, plate: `${truck.plate.slice(0, 6)}9`, condition: 50 }).returning();
    const model = powerUnitModel(truck.modelId);
    const r = await scrapVehicle(db(), p.userId, truck.id);
    expect(r).toEqual({ cents: Math.round(model.priceCents * SCRAP.share), parts: SCRAP.parts[model.kind] });
    expect((await db().select().from(vehicles).where(eq(vehicles.id, truck.id)))[0]!.soldAt).not.toBeNull();
    expect(await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc.id), eq(ledgerEntries.idempotencyKey, `scrap:${truck.id}`)))).toHaveLength(1);
    expect(await code(scrapVehicle(db(), p.userId, truck.id))).toBe('vehicle_not_found');
    expect((await repairWithPart(db(), p.userId, second!.id)).condition).toBe(50 + SCRAP.repairPerPart);
  });

  it('the museum takes old trucks of the members, up to its size', async () => {
    const p = await playerWithCompany();
    const { truck } = await ownTruck(p.userId);
    expect(await code(donateToMuseum(db(), p.userId, truck.id))).toBe('no_museum');
    const m = (await membershipOf(db(), p.userId))!;
    await db().update(organizations).set({ upgrades: { ...(m.company.upgrades as object), museum: 1 } }).where(eq(organizations.id, m.company.id));
    expect(await code(donateToMuseum(db(), p.userId, truck.id))).toBe('young');
    await db().update(vehicles).set({ odometerKm: MUSEUM.minKm + 1 }).where(eq(vehicles.id, truck.id));
    const before = await coins(p.userId);
    expect(await donateToMuseum(db(), p.userId, truck.id)).toEqual({ coins: MUSEUM.coins });
    expect(await coins(p.userId)).toBe(before + MUSEUM.coins);
    const shown = await museumOf(db(), m.company.id);
    expect(shown.map((e) => e.plate)).toEqual([truck.plate]);
    expect((await db().select().from(vehicles).where(eq(vehicles.id, truck.id)))[0]!.status).toBe('museum');
    expect(await db().select().from(museumExhibits).where(eq(museumExhibits.vehicleId, truck.id))).toHaveLength(1);
  });
});
