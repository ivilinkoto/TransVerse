import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { CYCLE, cycleIndex, cyclePhase, INTERMODAL, SUPPLY, supplyAfter } from '@/lib/game/living';
import { closeDb } from '@/server/db/client';
import { cityMarkets, companies, contracts, intermodalShipments, ledgerEntries, vehicles } from '@/server/db/schema';
import { acceptContract, recoverDemand, settleDueDeliveries } from '@/server/game/deliveries';
import { loadHubs } from '@/server/game/contracts';
import { ensureIntermodal, intermodalBoard, lineOf, releaseIntermodal } from '@/server/game/intermodal';
import { approximateProvider } from '@/server/geo/routing';
import { cityByName, db, grantLicences, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

/** The player's idle truck takes a contract from its origin and arrives. */
async function drive(userId: string, contractId: string) {
  const [c] = await db().select().from(contracts).where(eq(contracts.id, contractId));
  const [account] = await db().select().from(companies).where(eq(companies.ownerId, userId));
  const [truck] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, account!.id), eq(vehicles.status, 'idle')));
  await db().update(vehicles).set({ cityId: c!.originCityId }).where(eq(vehicles.id, truck!.id));
  const d = await acceptContract(db(), userId, contractId, truck!.id);
  await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), account!.id);
  return d.id;
}

describe('the economic cycle', () => {
  it('stays in its band, is the same for everyone in a week, and differs by country', () => {
    const now = new Date('2027-10-04T12:00:00Z');
    for (let w = 0; w < 60; w++) {
      const at = new Date(now.getTime() + w * 7 * 86_400_000);
      for (const c of [undefined, 'BG', 'DE', 'UA']) {
        const v = cycleIndex(at, c);
        expect(v).toBeGreaterThanOrEqual(CYCLE.min);
        expect(v).toBeLessThanOrEqual(CYCLE.max);
      }
    }
    expect(cycleIndex(now, 'BG')).toBe(cycleIndex(new Date(now.getTime() + 3_600_000), 'BG'));
    expect(cyclePhase(1.08)).toBe('boom');
    expect(cyclePhase(0.9)).toBe('slowdown');
    expect(cyclePhase(1)).toBe('steady');
  });
});

describe('supply', () => {
  it('a city that ships a cargo has less of it, and fills up again by the hour', async () => {
    expect(supplyAfter(1, 10)).toBeCloseTo(1 - 10 * SUPPLY.dropPerTon);
    expect(supplyAfter(0.41, 100)).toBe(SUPPLY.floor);
    const p = await newPlayer('Sofia');
    const sofia = await cityByName('Sofia');
    const c = await makeContract('Sofia', 'Plovdiv', { weightTons: 5, windowMinutes: 3 * 24 * 60 });
    await db().update(cityMarkets).set({ produces: true }).where(and(eq(cityMarkets.cityId, sofia.id), eq(cityMarkets.cargoType, 'pallets')));
    await db().update(cityMarkets).set({ supply: 1 }).where(and(eq(cityMarkets.cityId, sofia.id), eq(cityMarkets.cargoType, 'pallets')));
    await drive(p.userId, c.id);
    const [after] = await db().select().from(cityMarkets).where(and(eq(cityMarkets.cityId, sofia.id), eq(cityMarkets.cargoType, 'pallets')));
    expect(after!.supply).toBeCloseTo(1 - 5 * SUPPLY.dropPerTon);
    await recoverDemand(db(), 100);
    const [full] = await db().select().from(cityMarkets).where(and(eq(cityMarkets.cityId, sofia.id), eq(cityMarkets.cargoType, 'pallets')));
    expect(full!.supply).toBe(1);
  });
});

describe('intermodal containers', () => {
  it('only opens containers whose other terminal is a freight hub, so the last leg can start', async () => {
    const now = new Date();
    await db().update(intermodalShipments).set({ status: 'failed' }).where(inArray(intermodalShipments.status, ['leg1', 'on_line']));
    for (let i = 0; i < 4; i++) {
      await ensureIntermodal(db(), now, approximateProvider);
      await db().update(intermodalShipments).set({ status: 'failed' }).where(eq(intermodalShipments.status, 'leg1'));
    }
    const hubs = new Set((await loadHubs(db(), { now })).map((h) => h.id));
    const made = await db().select().from(intermodalShipments).where(gte(intermodalShipments.createdAt, now));
    expect(made.length).toBeGreaterThan(0);
    for (const s of made) {
      const line = lineOf(s.lineId)!;
      expect(hubs.has(s.reversed ? line.a : line.b)).toBe(true);
    }
  });

  it('a truck to the terminal, the line, the last leg first for the same driver — both pay a bonus', async () => {
    const now = new Date();
    // Containers left open by earlier runs would fill the board (and could be picked here).
    await db().update(intermodalShipments).set({ status: 'failed' }).where(inArray(intermodalShipments.status, ['leg1', 'on_line']));
    expect(await ensureIntermodal(db(), now, approximateProvider)).toBeGreaterThan(0);
    const [s] = await db().select().from(intermodalShipments).where(eq(intermodalShipments.status, 'leg1')).orderBy(desc(intermodalShipments.createdAt)).limit(1);
    expect(s!.leg1ContractId).toBeTruthy();
    // A light load of pallets, so the starter truck can take it.
    await db().update(intermodalShipments).set({ tons: 5, cargoType: 'pallets' }).where(eq(intermodalShipments.id, s!.id));
    await db().update(contracts).set({ weightTons: 5, cargoType: 'pallets', minLevel: 1, minReputation: 0, windowMinutes: 7 * 24 * 60 }).where(eq(contracts.id, s!.leg1ContractId!));
    const p = await newPlayer('Sofia');
    await grantLicences(p.userId, 'international', 'customs');
    const leg1 = await drive(p.userId, s!.leg1ContractId!);
    const [onLine] = await db().select().from(intermodalShipments).where(eq(intermodalShipments.id, s!.id));
    expect(onLine!.status).toBe('on_line');
    expect(onLine!.firstUserId).toBe(p.userId);
    const [b1] = await db().select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, `delivery:${leg1}:intermodal`));
    expect(b1?.amountCents ?? 0).toBeGreaterThan(0);
    expect((await intermodalBoard(db())).some((r) => r.id === s!.id)).toBe(true);

    expect(await releaseIntermodal(db(), new Date(onLine!.readyAt!.getTime() - 60_000), approximateProvider)).toBe(0);
    expect(await releaseIntermodal(db(), new Date(onLine!.readyAt!.getTime() + 1000), approximateProvider)).toBeGreaterThan(0);
    const [leg2Row] = await db().select().from(intermodalShipments).where(eq(intermodalShipments.id, s!.id));
    expect(leg2Row!.status).toBe('leg2');
    const [c2] = await db().select().from(contracts).where(eq(contracts.id, leg2Row!.leg2ContractId!));
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    expect(c2!.reservedByCompanyId).toBe(account!.id);
    await db().update(contracts).set({ minLevel: 1, minReputation: 0, windowMinutes: 7 * 24 * 60, reservedUntil: new Date(Date.now() + INTERMODAL.holdHours * 3_600_000) }).where(eq(contracts.id, c2!.id));
    const leg2 = await drive(p.userId, c2!.id);
    const [done] = await db().select().from(intermodalShipments).where(eq(intermodalShipments.id, s!.id));
    expect(done!.status).toBe('done');
    const [b2] = await db().select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, `delivery:${leg2}:intermodal`));
    const [freight] = await db().select({ reward: contracts.rewardCents }).from(contracts).where(eq(contracts.id, c2!.id));
    expect(b2!.amountCents).toBeGreaterThanOrEqual(Math.floor(freight!.reward * INTERMODAL.sameDriverShare * 0.5));
  });
});
