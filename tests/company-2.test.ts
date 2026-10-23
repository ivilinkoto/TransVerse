import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { memberBonuses } from '@/lib/game/company';
import { DRIVER_OF_MONTH } from '@/lib/game/community';
import { BUILDINGS, upgradesFromBuildings } from '@/lib/game/plot';
import { CLEARANCE } from '@/lib/game/trade';
import { closeDb } from '@/server/db/client';
import { companies, companyChronicle, deliveries, depots, jobState, ledgerEntries, organizations, treasuryEntries, userBadges, vehicles, warehouseStock } from '@/server/db/schema';
import { chronicleOf } from '@/server/game/chronicle';
import { awardDriversOfMonth, setDriverOfMonthPrize } from '@/server/game/community';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { addCompanyXp, joinCompany } from '@/server/game/membership';
import { clearStock } from '@/server/game/trade';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const orgOf = async (userId: string) => (await db().select().from(organizations).where(eq(organizations.ownerId, userId)))[0]!;
const accountOf = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;

describe('the company in v1.5, part 2', () => {
  it('the driving range: its level makes the drivers learn faster', () => {
    expect(BUILDINGS.polygon.maxLevel).toBe(3);
    const ups = upgradesFromBuildings([{ type: 'polygon', level: 2 }], {});
    expect(ups.polygon).toBe(2);
    expect(memberBonuses(ups).driverXpMultiplier).toBeCloseTo(1.3);
    expect(memberBonuses({}).driverXpMultiplier).toBe(1);
  });

  it('the chronicle keeps the big moments and ends with the founding', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().transaction((tx) => addCompanyXp(tx, org.id, 1_000_000));
    const items = await chronicleOf(db(), org.id);
    expect(items[0]!.kind).toBe('level');
    expect(items.at(-1)!.kind).toBe('founded');
    expect(await db().select().from(companyChronicle).where(eq(companyChronicle.organizationId, org.id))).toHaveLength(1);
  });

  it('clearing the warehouse: only goods that sat there, for a share of their cost', async () => {
    const p = await playerWithCompany('Sofia');
    const acc = await accountOf(p.userId);
    const [depot] = await db().select().from(depots).where(eq(depots.companyId, acc.id));
    await db().insert(warehouseStock).values({ depotId: depot!.id, cargoType: 'pallets', tons: 10, costCents: 10_000_00, updatedAt: new Date() });
    expect(await code(clearStock(db(), p.userId, depot!.id, 'pallets'))).toBe('too_fresh');
    await db().update(warehouseStock).set({ updatedAt: new Date(Date.now() - (CLEARANCE.minDays + 1) * 86_400_000) }).where(eq(warehouseStock.depotId, depot!.id));
    const before = (await accountOf(p.userId)).balanceCents;
    const r = await clearStock(db(), p.userId, depot!.id, 'pallets');
    expect(r.cents).toBe(Math.round(10_000_00 * CLEARANCE.share));
    expect((await accountOf(p.userId)).balanceCents).toBe(before + r.cents);
    expect(await db().select().from(warehouseStock).where(eq(warehouseStock.depotId, depot!.id))).toHaveLength(0);
  });

  it('driver of the month: the member with the most trips, a badge and the prize from the treasury', async () => {
    const owner = await playerWithCompany('Sofia');
    const org = await orgOf(owner.userId);
    await db().update(organizations).set({ recruitment: 'open', treasuryCents: 100_000_00 }).where(eq(organizations.id, org.id));
    expect(await code(setDriverOfMonthPrize(db(), owner.userId, 123))).toBe('bad_prize');
    await setDriverOfMonthPrize(db(), owner.userId, DRIVER_OF_MONTH.prizes[2]);
    const m = await newPlayer('Sofia');
    await joinCompany(db(), m.userId, org.id);
    const acc = await accountOf(m.userId);
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc.id));
    // Three trips that ended last month.
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
    for (let i = 0; i < DRIVER_OF_MONTH.minTrips; i++) {
      const c = await makeContract('Sofia', 'Pernik');
      const d = await acceptContract(db(), m.userId, c.id, truck!.id);
      await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc.id);
      await db().update(deliveries).set({ completedAt: lastMonth }).where(eq(deliveries.id, d.id));
      await db().update(vehicles).set({ cityId: c.originCityId }).where(eq(vehicles.id, truck!.id));
    }
    // The monthly run happens once (a local test database may keep the mark of an earlier run).
    await db().delete(jobState).where(like(jobState.key, 'driver-of-month:%'));
    await awardDriversOfMonth(db(), now);
    const after = await orgOf(owner.userId);
    expect(after.driverOfMonth?.userId).toBe(m.userId);
    expect((await db().select().from(treasuryEntries).where(and(eq(treasuryEntries.organizationId, org.id), eq(treasuryEntries.category, 'member_bonus')))).map((e) => e.amountCents)).toEqual([-DRIVER_OF_MONTH.prizes[2]]);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, m.userId), eq(userBadges.badge, DRIVER_OF_MONTH.badge)))).toHaveLength(1);
    expect(await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, acc.id), eq(ledgerEntries.category, 'member_bonus')))).toHaveLength(1);
  });
});
