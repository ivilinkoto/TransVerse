import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// As released (before the date these are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true, featureDate: () => new Date('2026-01-01T00:00:00Z') }));
import { memberBonuses } from '@/lib/game/company';
import { MAINTENANCE, maintenanceCostCents, maintenanceState } from '@/lib/game/maintenance';
import { closeDb } from '@/server/db/client';
import { companies, companyBuildings, ledgerEntries, organizations, vehicles } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { buyVehicle, serviceVehicle } from '@/server/game/fleet';
import { setCompanyLivery, setLivery } from '@/server/game/livery';
import { joinCompany, updateSettings } from '@/server/game/membership';
import { likePlot, publicPlot, topBases } from '@/server/game/plot';
import { fleetView } from '@/server/game/queries';
import { tradeOverview } from '@/server/game/trade';
import { db, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;

describe('maintenance', () => {
  it('overdue trucks get into trouble more often, freshly serviced ones less', () => {
    expect(maintenanceState(1000, 0)).toMatchObject({ fresh: true, overdue: false, factor: MAINTENANCE.freshFactor });
    expect(maintenanceState(4000, 0)).toMatchObject({ fresh: false, overdue: false, factor: 1, dueInKm: MAINTENANCE.intervalKm - 4000 });
    expect(maintenanceState(9000, 2000)).toMatchObject({ overdue: true, factor: MAINTENANCE.overdueFactor });
    expect(maintenanceCostCents(10_000_00)).toBe(MAINTENANCE.minCostCents);
    expect(maintenanceCostCents(200_000_00, 0.5)).toBe(Math.round(200_000_00 * MAINTENANCE.costShare * 0.5));
  });

  it('a service resets the kilometres and is paid once', async () => {
    const p = await playerWithCompany('Sofia', 200_000_00);
    const v = await buyVehicle(db(), p.userId, 'danubia-t440', p.hq.id);
    expect(await code(serviceVehicle(db(), p.userId, v.id))).toBe('fresh');
    await db().update(vehicles).set({ odometerKm: 8000 }).where(eq(vehicles.id, v.id));
    const cost = await serviceVehicle(db(), p.userId, v.id);
    expect(cost).toBe(maintenanceCostCents(98_000_00));
    const [after] = await db().select().from(vehicles).where(eq(vehicles.id, v.id));
    expect(after!.serviceKm).toBe(8000);
    const paid = await db().select().from(ledgerEntries).where(eq(ledgerEntries.refId, v.id));
    expect(paid.filter((e) => e.description.startsWith('Профилактика'))).toHaveLength(1);
  });
});

describe('company warehouse, livery and guests', () => {
  it('the plot warehouse adds room in the members\' warehouse in the base city', async () => {
    expect(memberBonuses({ warehouse: 2 }).warehouseTons).toBe(80);
    const p = await playerWithCompany('Sofia');
    const account = await accountOf(p.userId);
    const before = (await tradeOverview(db(), account.id)).find((d) => d.cityId === p.hq.id)!.capacityTons;
    await db().update(organizations).set({ upgrades: { warehouse: 2 } }).where(eq(organizations.id, (await orgOf(p.userId)).id));
    const after = (await tradeOverview(db(), account.id)).find((d) => d.cityId === p.hq.id)!.capacityTons;
    expect(after - before).toBe(80);
  });

  it('members\' own trucks wear the livery unless they opt out', async () => {
    const owner = await playerWithCompany('Sofia', 200_000_00);
    const v = await buyVehicle(db(), owner.userId, 'danubia-t440', owner.hq.id);
    const account = await accountOf(owner.userId);
    const own = (await fleetView(db(), account.id)).vehicles.find((x) => x.id === v.id)!;
    expect(own.color).toBe(v.color);
    expect(await code(setLivery(db(), owner.userId, '#123456'))).toBe('bad_color');
    await setLivery(db(), owner.userId, '#047857');
    const fleet = (await fleetView(db(), account.id)).vehicles;
    expect(fleet.find((x) => x.id === v.id)!.color).toBe('#047857');
    // A rented truck keeps the landlord's colours.
    for (const r of fleet.filter((x) => x.ownership === 'rented')) expect(r.color).not.toBe('#047857');
    await setCompanyLivery(db(), owner.userId, false);
    expect((await fleetView(db(), account.id)).vehicles.find((x) => x.id === v.id)!.color).toBe(v.color);
  });

  it('players like other companies\' bases (not their own); the most liked rank first', async () => {
    const a = await playerWithCompany('Sofia');
    const b = await playerWithCompany('Sofia');
    const orgA = await orgOf(a.userId);
    const orgB = await orgOf(b.userId);
    await db().insert(companyBuildings).values([{ organizationId: orgA.id, type: 'office', x: 1, y: 1, level: 1 }, { organizationId: orgB.id, type: 'office', x: 1, y: 1, level: 2 }]).onConflictDoNothing();
    expect(await code(likePlot(db(), a.userId, orgA.id))).toBe('own_base');
    const fan = await newPlayer();
    expect(await likePlot(db(), fan.userId, orgA.id)).toEqual({ liked: true });
    expect(await likePlot(db(), b.userId, orgA.id)).toEqual({ liked: true });
    const view = (await publicPlot(db(), orgA.id, fan.userId))!;
    expect(view.likes).toBe(2);
    expect(view.liked).toBe(true);
    expect(await likePlot(db(), fan.userId, orgA.id)).toEqual({ liked: false });
    expect((await publicPlot(db(), orgA.id, fan.userId))!.likes).toBe(1);
    const top = await topBases(db());
    const ia = top.findIndex((r) => r.id === orgA.id);
    const ib = top.findIndex((r) => r.id === orgB.id);
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(ib === -1 || ia < ib).toBe(true);
    // A member likes nothing of their own company either.
    await updateSettings(db(), b.userId, { recruitment: 'open', minJoinLevel: 1, contributionRate: 0.05 });
    const member = await newPlayer();
    await joinCompany(db(), member.userId, orgB.id);
    expect(await code(likePlot(db(), member.userId, orgB.id))).toBe('own_base');
  });
});
