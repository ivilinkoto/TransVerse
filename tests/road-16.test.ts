import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { applyBorderQueues, borderQueueFactor, refuelPriceCents, SECURE_PARKING, TRAFFIC, trafficFactor } from '@/lib/game/traffic';
import { closeDb } from '@/server/db/client';
import { companies, deliveries, routes, vehicles } from '@/server/db/schema';
import { acceptContract } from '@/server/game/deliveries';
import { db, grantLicences, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('road rules', () => {
  it('border queues by day and hour (Sofia time)', () => {
    expect(borderQueueFactor(Date.parse('2027-03-19T14:00:00Z'))).toBe(2); // Friday 16:00
    expect(borderQueueFactor(Date.parse('2027-03-21T16:00:00Z'))).toBe(1.75); // Sunday 18:00
    expect(borderQueueFactor(Date.parse('2027-03-17T01:00:00Z'))).toBe(0.6); // Wednesday 03:00
    expect(borderQueueFactor(Date.parse('2027-03-17T09:00:00Z'))).toBe(1);
    const at = Date.parse('2027-03-19T13:30:00Z');
    const segs = [{ kind: 'border', start: at, end: at + 60 * 60_000 }, { kind: 'drive', start: at + 60 * 60_000, end: at + 120 * 60_000 }];
    const out = applyBorderQueues(segs);
    expect(out[0]!.end - out[0]!.start).toBe(120 * 60_000);
    expect(out[1]!.end).toBe(segs[1]!.end + 60 * 60_000);
  });

  it('refuelling in the cheapest country, as far as the tank reaches; traffic', () => {
    expect(refuelPriceCents(160, 140, 500, 800, 30)).toBe(140);
    expect(refuelPriceCents(160, 140, 4000, 800, 30)).toBeGreaterThan(140);
    expect(refuelPriceCents(160, 170, 500, 800, 30)).toBe(160);
    expect(trafficFactor(TRAFFIC.from - 1)).toBe(1);
    expect(trafficFactor(TRAFFIC.from + 1)).toBeCloseTo(1 + 2 * TRAFFIC.perTruck);
    expect(trafficFactor(100)).toBeCloseTo(1 + TRAFFIC.max);
  });
});

describe('choices at the start', () => {
  it('the cheap route, the guarded car park and refuelling', async () => {
    const p = await newPlayer('Sofia');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    await db().update(vehicles).set({ ownership: 'owned' }).where(eq(vehicles.id, truck!.id));
    await grantLicences(p.userId, 'international', 'customs');
    const c = await makeContract('Sofia', 'Hamburg', { windowMinutes: 10 * 24 * 60 });
    const d = await acceptContract(db(), p.userId, c.id, truck!.id, new Date(), { route: 'cheap', parking: 'secure', refuel: true });
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const [route] = await db().select().from(routes).where(eq(routes.id, row!.routeId));
    expect(route!.profile).toBe('truck_cheap');
    const costs = row!.estimatedCosts as { parkingCents: number; theftCents: number; tollCents: number };
    const rests = (row!.schedule as { kind: string }[]).filter((s) => s.kind === 'rest').length;
    expect(rests).toBeGreaterThan(0);
    expect(costs.parkingCents).toBe(rests * SECURE_PARKING.feeCents);
    expect(costs.theftCents).toBe(0);
  });
});
