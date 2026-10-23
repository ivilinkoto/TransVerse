import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { railOptions } from '@/lib/game/crossings';
import { CABOTAGE } from '@/lib/game/europe';
import { closeDb } from '@/server/db/client';
import { companies, contracts, deliveries, routes, vehicles } from '@/server/db/schema';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { cabotageUsed, ensureTransEuropeLoads } from '@/server/game/europe';
import { cityByName, db, grantLicences, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const ownTruckAt = async (userId: string, city: string) => {
  const [acc] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
  await db().update(vehicles).set({ ownership: 'owned', cityId: (await cityByName(city)).id }).where(eq(vehicles.id, truck!.id));
  return { acc: acc!, truck: truck! };
};

describe('v1.7 across Europe', () => {
  it('a sea line is offered when the ports make the way clearly shorter, and the truck takes it', async () => {
    const [tirana, rome, bari, durres] = await Promise.all(['Tirana', 'Rome', 'Bari', 'Durrës'].map(cityByName));
    const terminals = new Map([bari, durres].map((c) => [c.id, c]));
    const options = railOptions(tirana, rome, terminals, 1_500, true);
    expect(options.map((o) => `${o.line.id}:${o.reversed ? 'r' : 'f'}`)).toContain('bari-durres:r');
    expect(railOptions(tirana, rome, terminals, 1_500, false)).toEqual([]);
    const p = await newPlayer();
    await grantLicences(p.userId, 'international', 'customs');
    const { truck } = await ownTruckAt(p.userId, 'Tirana');
    const c = await makeContract('Tirana', 'Rome', { windowMinutes: 6 * 24 * 60 });
    await db().update(contracts).set({ distanceKm: 1_500 }).where(eq(contracts.id, c.id));
    const d = await acceptContract(db(), p.userId, c.id, truck.id, new Date(), { rail: 'bari-durres:r' });
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const [route] = await db().select().from(routes).where(eq(routes.id, row!.routeId));
    expect(route!.crossing?.lineId).toBe('bari-durres');
    expect((row!.schedule as { kind: string }[]).some((s) => s.kind === 'ferry')).toBe(true);
  });

  it('cabotage: three domestic loads in a foreign country within a week, then an international one is needed', async () => {
    const p = await newPlayer();
    await grantLicences(p.userId, 'international');
    const { acc, truck } = await ownTruckAt(p.userId, 'Milan');
    const first = await acceptContract(db(), p.userId, (await makeContract('Milan', 'Turin')).id, truck.id);
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, first.id));
    for (let i = 0; i < CABOTAGE.maxLoads - 1; i++) {
      const c = await makeContract('Milan', 'Bologna');
      const { id: _id, ...rest } = row!;
      await db().insert(deliveries).values({ ...rest, contractId: c.id, status: 'completed', completedAt: new Date() });
    }
    expect(await cabotageUsed(db(), acc.id, 'IT', new Date())).toBe(CABOTAGE.maxLoads);
    await db().update(deliveries).set({ status: 'completed', completedAt: new Date() }).where(eq(deliveries.id, first.id));
    await db().update(vehicles).set({ status: 'idle' }).where(eq(vehicles.id, truck.id));
    expect(await code(acceptContract(db(), p.userId, (await makeContract('Milan', 'Genoa')).id, truck.id))).toBe('cabotage');
    // An international load is fine (and a load at home never counts).
    expect(await code(acceptContract(db(), p.userId, (await makeContract('Milan', 'Vienna')).id, truck.id))).toBe('ok');
  });

  it('trans-European loads: far ends, a two-driver crew needed', async () => {
    await ensureTransEuropeLoads(db());
    const loads = await db().select().from(contracts).where(and(eq(contracts.transEurope, true), eq(contracts.status, 'open')));
    expect(loads.length).toBeGreaterThan(0);
    expect(loads.every((l) => l.distanceKm >= 1_500)).toBe(true);
    const p = await newPlayer();
    await grantLicences(p.userId, 'international', 'customs', 'reefer', 'adr', 'oversize');
    const load = loads[0]!;
    // A load the starter truck can carry: the check under test is the crew.
    await db().update(contracts).set({ cargoType: 'pallets', weightTons: 1 }).where(eq(contracts.id, load.id));
    const [origin] = await db().select().from(contracts).where(eq(contracts.id, load.id));
    const { truck } = await ownTruckAt(p.userId, 'Sofia');
    await db().update(vehicles).set({ cityId: origin!.originCityId }).where(eq(vehicles.id, truck.id));
    expect(await code(acceptContract(db(), p.userId, load.id, truck.id))).toBe('needs_team');
  });
});
