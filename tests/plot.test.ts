import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// The plot as released; companies founded after this date start with an empty plot.
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true, featureDate: () => new Date('2026-01-01T00:00:00Z') }));
import { memberBonuses } from '@/lib/game/company';
import { BUILDING_TYPES, BUILDINGS, DEFAULT_SPOTS, levelSpec, type BuildingType, materialCostCents, missing, PLOT, placementError, splitLoads, upgradesFromBuildings } from '@/lib/game/plot';
import { closeDb } from '@/server/db/client';
import { companies, companyBuildings, companyBuilds, contracts, organizations, vehicles } from '@/server/db/schema';
import { openContracts } from '@/server/game/contracts';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { buyCompanyUpgrade, joinCompany, updateSettings } from '@/server/game/membership';
import { buyDelivered, cancelBuild, ensurePlot, finishConstructions, orderMaterials, placeBuilding, plotView, startConstruction, upgradeBuilding } from '@/server/game/plot';
import { approximateProvider } from '@/server/geo/routing';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;

describe('plot rules', () => {
  it('levels need more materials and time; costs add up', () => {
    const one = levelSpec('office', 1);
    const two = levelSpec('office', 2);
    expect(one.materials).toEqual({ cement: 14, bricks: 14, glass: 3 });
    expect(two.materials.steel).toBeGreaterThan(0);
    expect(two.minutes).toBeGreaterThan(one.minutes);
    expect(materialCostCents({ cement: 10 })).toBe(10 * 180_00);
    expect(materialCostCents({ cement: 10 }, true)).toBe(Math.round(10 * 180_00 * PLOT.deliveredMarkup));
    expect(missing({ cement: 14, glass: 3 }, { cement: 10 }, { glass: 3 })).toEqual({ cement: 4 });
    expect(splitLoads('cement', 15)).toEqual([5, 5, 5]);
    expect(splitLoads('cement', 14)).toEqual([7, 7]);
    expect(splitLoads('steel', 12)).toEqual([12]);
  });

  it('buildings stay on the plot, off the driveway and apart', () => {
    expect(placementError('office', 1, 1, [])).toBeNull();
    expect(placementError('office', 12, 1, [])).toMatch(/извън/);
    expect(placementError('office', 5, 6, [])).toMatch(/пътят/);
    expect(placementError('training', 2, 2, [{ type: 'office', x: 1, y: 1 }])).toMatch(/Офис/);
  });

  it('the default spots of converted companies fit together', () => {
    const placed: { type: BuildingType; x: number; y: number }[] = [];
    for (const type of Object.keys(DEFAULT_SPOTS) as (keyof typeof DEFAULT_SPOTS)[]) {
      expect(placementError(type, DEFAULT_SPOTS[type].x, DEFAULT_SPOTS[type].y, placed)).toBeNull();
      placed.push({ type, ...DEFAULT_SPOTS[type] });
    }
  });

  it('buildings drive the company upgrades; service and parking have effects', () => {
    expect(upgradesFromBuildings([{ type: 'office', level: 3 }, { type: 'logistics', level: 2 }], { rental_partner: 1 })).toEqual({ rental_partner: 1, capacity: 2, logistics: 2 });
    const b = memberBonuses({ service: 2, parking: 1 });
    expect(b.repairDiscount).toBeCloseTo(0.2);
    expect(b.parkingSlots).toBe(1);
    expect(BUILDINGS.office.maxLevel).toBeGreaterThan(1);
  });
});

describe('building on the plot', () => {
  it('office first: materials hauled by members (or bought delivered), then the timer', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().update(organizations).set({ treasuryCents: 2_000_000_00 }).where(eq(organizations.id, org.id));
    // A company founded after the plot came starts empty.
    expect((await plotView(db(), org.id))!.buildings).toHaveLength(0);
    expect(await code(placeBuilding(db(), owner.userId, 'logistics', 8, 0))).toBe('office_first');
    expect(await code(placeBuilding(db(), owner.userId, 'office', 5, 6))).toBe('bad_place');
    const build = await placeBuilding(db(), owner.userId, 'office', 1, 1);
    expect(await code(placeBuilding(db(), owner.userId, 'office', 1, 1))).toBe('already_placed');
    // Upgrades that became buildings are not bought any more.
    expect(await code(buyCompanyUpgrade(db(), owner.userId, 'capacity'))).toBe('use_plot');

    const before = (await orgOf(owner.userId)).treasuryCents;
    const order = await orderMaterials(db(), owner.userId, build.id, new Date(), approximateProvider);
    expect(order.loads).toBeGreaterThanOrEqual(5);
    expect(order.costCents).toBe(materialCostCents(levelSpec('office', 1).materials));
    expect((await orgOf(owner.userId)).treasuryCents).toBe(before - order.costCents);
    expect(await code(cancelBuild(db(), owner.userId, build.id))).toBe('started');
    // Ordering again buys nothing: everything is on the way.
    expect((await orderMaterials(db(), owner.userId, build.id, new Date(), approximateProvider)).costCents).toBe(0);

    // Only members see the loads.
    const mine = await openContracts(db(), { memberOfCompanyId: org.id, limit: 300 });
    const loads = mine.filter((c) => c.constructionId === build.id);
    expect(loads.length).toBe(order.loads);
    expect((await openContracts(db(), { limit: 300 })).some((c) => c.constructionId === build.id)).toBe(false);

    // The owner hauls one load from the supplier: it counts on arrival.
    const load = loads.find((c) => c.weightTons <= 7.5)!;
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, owner.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    await db().update(vehicles).set({ cityId: load.originCityId }).where(eq(vehicles.id, truck!.id));
    const d = await acceptContract(db(), owner.userId, load.id, truck!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
    const [afterLoad] = await db().select().from(companyBuilds).where(eq(companyBuilds.id, build.id));
    expect(afterLoad!.delivered[load.material as 'cement']).toBeCloseTo(load.weightTons, 5);

    // The rest expires unhauled; it is put back on the board for free, or bought delivered.
    await db().update(contracts).set({ status: 'expired' }).where(and(eq(contracts.constructionId, build.id), eq(contracts.status, 'open')));
    expect(await code(startConstruction(db(), owner.userId, build.id))).toBe('materials_missing');
    const t0 = (await orgOf(owner.userId)).treasuryCents;
    const delivered = await buyDelivered(db(), owner.userId, build.id);
    expect(delivered.costCents).toBeGreaterThan(0);
    expect((await orgOf(owner.userId)).treasuryCents).toBe(t0 - delivered.costCents);

    const now = new Date();
    const endsAt = await startConstruction(db(), owner.userId, build.id, now);
    expect(endsAt.getTime()).toBe(now.getTime() + levelSpec('office', 1).minutes * 60_000);
    expect(await finishConstructions(db(), new Date(endsAt.getTime() - 1000))).toBe(0);
    expect(await finishConstructions(db(), new Date(endsAt.getTime() + 1000))).toBe(1);
    const view = (await plotView(db(), org.id))!;
    expect(view.buildings.find((b) => b.type === 'office')!.level).toBe(1);
    expect(view.construction).toBeNull();

    // Next: a level up of the office opens a new construction.
    const up = await upgradeBuilding(db(), owner.userId, 'office');
    expect(up.targetLevel).toBe(2);
    expect(await code(placeBuilding(db(), owner.userId, 'logistics', 8, 0))).toBe('busy');
  });

  it('only the owner and ranks with "build" may build', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await updateSettings(db(), owner.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const driver = await newPlayer();
    await joinCompany(db(), driver.userId, org.id);
    expect(await code(placeBuilding(db(), driver.userId, 'office', 1, 1))).toBe('forbidden');
  });

  it('companies from before the plot get their upgrades as finished buildings', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().update(organizations).set({ upgrades: { capacity: 2, logistics: 1, rental_partner: 1 } }).where(eq(organizations.id, org.id));
    await ensurePlot(db(), { id: org.id, createdAt: new Date('2025-06-01T00:00:00Z'), upgrades: { capacity: 2, logistics: 1, rental_partner: 1 } });
    const rows = await db().select().from(companyBuildings).where(eq(companyBuildings.organizationId, org.id));
    expect(rows.map((b) => [b.type, b.level]).sort()).toEqual([['logistics', 1], ['office', 3]]);
    // Calling it again changes nothing.
    await ensurePlot(db(), { id: org.id, createdAt: new Date('2025-06-01T00:00:00Z'), upgrades: { capacity: 2, logistics: 1 } });
    expect(await db().select().from(companyBuildings).where(eq(companyBuildings.organizationId, org.id))).toHaveLength(2);
  });
});
