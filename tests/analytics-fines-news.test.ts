import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { analyze, type DeliveryRow } from '@/lib/game/analytics';
import { canOverload, FINE_RULES, fineCents, insurancePriceCents } from '@/lib/game/fines';
import { planRoadEvents } from '@/lib/game/road-events';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, drivers, fines, ledgerEntries, vehicles } from '@/server/db/schema';
import { acceptContract } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { appealFine, buyInsurance, collectOverdueFines, payFine } from '@/server/game/fines';
import { applyDueRoadEvents } from '@/server/game/road-events';
import { db, makeContract, newPlayer } from './helpers';

afterAll(async () => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

const row = (o: Partial<DeliveryRow>): DeliveryRow => ({
  id: 'x', completedAt: new Date('2026-10-17T10:00:00Z'), vehicleId: 'v1', driverId: 'd1', coDriverId: null, originCityId: 1, destCityId: 2, cargoType: 'pallets',
  emptyKm: 0, loadedKm: 100, tons: 5, rewardCents: 300_00, payoutCents: 200_00, late: false, fuelLitres: 20, fuelCents: 30_00, ...o,
});

describe('analytics', () => {
  it('totals, groups (a team counts for both drivers) and one row per day', () => {
    const from = new Date('2026-10-12T00:00:00Z');
    const a = analyze([row({}), row({ vehicleId: 'v2', coDriverId: 'd2', payoutCents: -50_00, late: true, destCityId: 3 }), row({ completedAt: new Date('2026-10-15T10:00:00Z') })], from, 7);
    expect(a).toMatchObject({ trips: 3, km: 300, netCents: 350_00, revenueCents: 900_00 });
    expect(a.onTimeShare).toBeCloseTo(2 / 3);
    expect(a.litresPer100).toBeCloseTo(20);
    expect(a.vehicles.map((v) => [v.key, v.netCents])).toEqual([['v1', 400_00], ['v2', -50_00]]);
    expect(a.drivers.find((d) => d.key === 'd2')!.trips).toBe(1);
    expect(a.lanes[0]!.key).toBe('1>2');
    expect(a.daily).toHaveLength(7);
    expect(a.daily.find((d) => d.day === '2026-10-17')!.trips).toBe(2);
  });
});

describe('fines and insurance', () => {
  it('rules: overload up to 10 %, fines grow with the offence, checks only for risks taken', () => {
    expect(canOverload(8.2, 7.5)).toBe(true);
    expect(canOverload(8.3, 7.5)).toBe(false);
    expect(fineCents('hours', 2.2)).toBe(400_00 + 3 * 120_00);
    expect(fineCents('overload', 4)).toBe(300_00 + 4 * 40_00);
    expect(insurancePriceCents(79_000_00)).toBe(348_00);
    const trip = [{ kind: 'drive' as const, leg: 'loaded' as const, start: 0, end: 3_600_000, fromKm: 0, toKm: 300 }];
    const police = (risks: { violation: 'hours' | 'overload'; amount: number }[]) => planRoadEvents(trip, { totalKm: 300, borders: 0, rented: false, random: () => 0.01, chance: 0, risks }).filter((e) => e.kind === 'police');
    expect(police([])).toHaveLength(0);
    expect(police([{ violation: 'overload', amount: 5 }])[0]).toMatchObject({ violation: 'overload', fineCents: fineCents('overload', 5) });
  });

  it('an overload or a skipped rest is the player\'s choice and is recorded on the trip', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const heavy = await makeContract('Sofia', 'Plovdiv', { weightTons: 8 }); // rigid 7.5 t
    expect(await code(acceptContract(db(), p.userId, heavy.id, truck!.id))).toBe('incompatible');
    await db().update(drivers).set({ dutyMin: 500, restedAt: new Date(Date.now() + 3_600_000) }).where(eq(drivers.vehicleId, truck!.id));
    const d = await acceptContract(db(), p.userId, heavy.id, truck!.id, new Date(), { overload: true, rush: true });
    expect([...d.violations].sort()).toEqual(['hours', 'overload']);
    // Without the rest: no early daily rest in the schedule.
    expect((d.schedule as { kind: string }[]).some((s) => s.kind === 'rest')).toBe(false);
  });

  it('a roadside check fines the player: pay, appeal (won or lost), or it is taken late with a surcharge', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    const job = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, job.id, truck!.id);
    const at = d.startedAt.getTime() + 60_000;
    const events = [
      { kind: 'police', at, delayMs: 1000, costCents: 0, applied: false, violation: 'overload', fineCents: 500_00 },
      { kind: 'police', at: at + 10, delayMs: 1000, costCents: 0, applied: false, violation: 'hours', fineCents: 600_00 },
    ];
    await db().update(deliveries).set({ roadEvents: events as never, nextEventAt: new Date(at) }).where(eq(deliveries.id, d.id));
    await applyDueRoadEvents(db(), new Date(at + 5_000));
    await applyDueRoadEvents(db(), new Date(at + 5_000)); // idempotent
    const issued = await db().select().from(fines).where(eq(fines.deliveryId, d.id));
    expect(issued.map((f) => f.violation).sort()).toEqual(['hours', 'overload']);
    const overload = issued.find((f) => f.violation === 'overload')!;
    const hours = issued.find((f) => f.violation === 'hours')!;
    expect(await appealFine(db(), p.userId, overload.id, new Date(), 0.99)).toEqual({ won: false, amountCents: Math.round(500_00 * (1 + FINE_RULES.appealLossShare)) });
    expect(await code(appealFine(db(), p.userId, overload.id))).toBe('already_appealed');
    await payFine(db(), p.userId, overload.id);
    expect(await code(payFine(db(), p.userId, overload.id))).toBe('fine_closed');
    // The other one is not paid in time.
    await collectOverdueFines(db(), new Date(Date.now() + (FINE_RULES.dueHours + 1) * 3_600_000));
    const [late] = await db().select().from(fines).where(eq(fines.id, hours.id));
    expect(late).toMatchObject({ status: 'auto_paid', amountCents: Math.round(600_00 * (1 + FINE_RULES.latePayShare)) });
    const paid = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account!.id), eq(ledgerEntries.category, 'fines')));
    expect(paid.map((e) => e.amountCents).sort((a, b) => a - b)).toEqual([-900_00, -625_00]);
  });

  it('insurance pays the road-assistance bill of a breakdown', async () => {
    const p = await newPlayer();
    const [account] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, account!.id));
    expect(await code(buyInsurance(db(), p.userId, truck!.id))).toBe('rented');
    await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, truck!.id));
    await db().update(companies).set({ balanceCents: 10_000_00 }).where(eq(companies.id, account!.id));
    const { price } = await buyInsurance(db(), p.userId, truck!.id);
    expect(price).toBe(insurancePriceCents(79_000_00));
    const job = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, job.id, truck!.id);
    const at = d.startedAt.getTime() + 60_000;
    await db().update(deliveries).set({ roadEvents: [{ kind: 'breakdown', at, delayMs: 1000, costCents: 300_00, applied: false }], nextEventAt: new Date(at) }).where(eq(deliveries.id, d.id));
    await applyDueRoadEvents(db(), new Date(at + 5_000));
    const bills = await db().select().from(ledgerEntries).where(and(eq(ledgerEntries.companyId, account!.id), eq(ledgerEntries.category, 'road_events')));
    expect(bills).toHaveLength(0);
  });
});
