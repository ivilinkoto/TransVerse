import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { crossingLine, islandOf, nextDeparture } from '@/lib/game/crossings';
import { buildGameTrip, stateAt, type Segment } from '@/lib/game/schedule';
import { conditionFromWeather } from '@/lib/game/winter';
import { closeDb } from '@/server/db/client';
import { cities, companies, contracts, deliveries, ledgerEntries, routes, shipCalls, vehicles, weatherNow } from '@/server/db/schema';
import { addLoad } from '@/server/game/contracts';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { ensurePortLoads, settleShipCalls, startShipCall } from '@/server/game/ports';
import { fetchWeather, realConditions } from '@/server/game/weather';
import { approximateProvider } from '@/server/geo/routing';
import { cityByName, db, grantLicences, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const account = async (userId: string) => (await db().select().from(companies).where(eq(companies.ownerId, userId)))[0]!;
const truck = async (userId: string) => {
  const [v] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, (await account(userId)).id), sql`${vehicles.soldAt} is null`));
  return v!;
};

describe('ferries and trains in the schedule', () => {
  it('the truck waits for the next departure on the quay, then rides on board', () => {
    const line = crossingLine('piraeus-heraklion')!;
    const startAt = Date.UTC(2027, 0, 10, 10, 7);
    const trip = buildGameTrip({
      startAt,
      empty: null,
      loaded: { km: 30 + line.km + 20, durationS: 50 * 60, borderKms: [], crossing: { kind: 'ferry', fromKm: 30, toKm: 30 + line.km, realMin: line.hours * 60, gameMin: 27, boardingMin: 5, everyMin: 60, note: 'Ферибот Пирея → Ираклио' } },
      speedFactor: 1,
    });
    const ferry = trip.segments.filter((s) => s.kind === 'ferry');
    expect(ferry).toHaveLength(2);
    const [wait, board] = ferry as [Segment, Segment];
    expect(wait.fromKm).toBe(30);
    expect(wait.toKm).toBe(30);
    expect(board.start).toBe(nextDeparture('ferry', board.start));
    expect(board.end - board.start).toBe(27 * 60_000);
    expect(stateAt(trip.segments, (wait.start + wait.end) / 2).km).toBe(30);
    expect(stateAt(trip.segments, (board.start + board.end) / 2).km).toBeCloseTo(30 + line.km / 2);
  });

  it('islands are real islands', () => {
    expect(islandOf({ lat: 35.33, lon: 25.14 })?.id).toBe('crete');
    expect(islandOf({ lat: 42.69, lon: 23.32 })).toBeNull();
  });
});

describe('loads over the sea', () => {
  it('a load to Crete goes over the ferry from Piraeus; the ticket is paid on arrival', async () => {
    const athens = await cityByName('Athens');
    const heraklion = (await db().select().from(cities).where(eq(cities.id, 261745)))[0]!;
    const id = await addLoad(db(), athens.id, heraklion.id, 'pallets', 1, new Date(), 86_400_000, 1, {}, approximateProvider);
    expect(id).not.toBeNull();
    const [c] = await db().select().from(contracts).where(eq(contracts.id, id!));
    const [r] = await db().select().from(routes).where(eq(routes.id, c!.routeId));
    expect(r!.crossing).toMatchObject({ kind: 'ferry', lineId: 'piraeus-heraklion' });
    expect(r!.profile).toBe('truck:ferry:piraeus-heraklion:f');
    // From Crete: the same line, the other way.
    const back = await addLoad(db(), heraklion.id, athens.id, 'pallets', 1, new Date(), 86_400_000, 1, {}, approximateProvider);
    const [rb] = await db().select().from(routes).innerJoin(contracts, eq(contracts.routeId, routes.id)).where(eq(contracts.id, back!));
    expect(rb!.routes.profile).toBe('truck:ferry:piraeus-heraklion:r');

    const p = await newPlayer('Sofia');
    const v = await truck(p.userId);
    await db().update(vehicles).set({ cityId: athens.id }).where(eq(vehicles.id, v.id));
    await db().update(contracts).set({ weightTons: 1, minLevel: 1, cargoType: 'pallets' }).where(eq(contracts.id, id!));
    const d = await acceptContract(db(), p.userId, id!, v.id);
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    expect((row!.schedule as Segment[]).some((s) => s.kind === 'ferry' && s.toKm > s.fromKm)).toBe(true);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), (await account(p.userId)).id);
    const [ticket] = await db().select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, `delivery:${d.id}:crossing`));
    expect(ticket!.amountCents).toBe(-crossingLine('piraeus-heraklion')!.ticketCents);
  });

  it('"С влак": the truck rides the train for the long part', async () => {
    const p = await newPlayer('Sofia');
    await grantLicences(p.userId, 'international', 'customs');
    const v = await truck(p.userId);
    const hamburg = await cityByName('Hamburg');
    await db().update(vehicles).set({ cityId: hamburg.id }).where(eq(vehicles.id, v.id));
    const job = await makeContract('Hamburg', 'Budapest', { weightTons: 1 });
    await expect(acceptContract(db(), p.userId, job.id, v.id, new Date(), { rail: 'duisburg-istanbul:f' })).rejects.toThrow(/Влакът не е подходящ/);
    const d = await acceptContract(db(), p.userId, job.id, v.id, new Date(), { rail: 'hamburg-budapest:f' });
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const [r] = await db().select().from(routes).where(eq(routes.id, row!.routeId));
    expect(r!.profile).toBe('truck:rail:hamburg-budapest:f');
    expect((row!.schedule as Segment[]).filter((s) => s.kind === 'rail').length).toBe(2);
    expect((row!.estimatedCosts as { crossingCents: number }).crossingCents).toBe(crossingLine('hamburg-budapest')!.ticketCents);
  });
});

describe('ports', () => {
  it('containers wait at the big ports; a ship call brings many and ends', async () => {
    await ensurePortLoads(db(), new Date(), approximateProvider);
    const hamburg = await cityByName('Hamburg');
    const atPort = await db().select().from(contracts).where(and(eq(contracts.port, true), eq(contracts.originCityId, hamburg.id), eq(contracts.status, 'open')));
    expect(atPort.length).toBeGreaterThanOrEqual(1);
    expect(atPort.every((c) => c.cargoType === 'container')).toBe(true);

    const morning = new Date('2027-01-12T09:00:00Z'); // 11:00 in Sofia
    // Another test file's worker tick may have brought a ship in (by day): this test starts from none.
    await db().update(shipCalls).set({ status: 'done' }).where(eq(shipCalls.status, 'active'));
    expect(await startShipCall(db(), new Date('2027-01-12T03:00:00Z'), approximateProvider)).toBeNull();
    const call = await startShipCall(db(), morning, approximateProvider);
    expect(call!.containers).toBeGreaterThan(10);
    expect(await startShipCall(db(), new Date(morning.getTime() + 3_600_000), approximateProvider)).toBeNull();
    const loads = await db().select().from(contracts).where(eq(contracts.portCallId, call!.id));
    expect(loads).toHaveLength(call!.containers);

    expect(await settleShipCalls(db(), new Date(call!.endsAt.getTime() + 1000))).toBe(1);
    const [done] = await db().select().from(shipCalls).where(eq(shipCalls.id, call!.id));
    expect(done!.status).toBe('done');
    const open = await db().select().from(contracts).where(and(eq(contracts.portCallId, call!.id), eq(contracts.status, 'open')));
    expect(open).toHaveLength(0);
  });
});

describe('real weather', () => {
  it('snow, ice and blizzards come from the weather now', async () => {
    expect(conditionFromWeather({ tempC: -3, precipMm: 2, snowCm: 2, gustKmh: 70, code: 75 })).toBe('blizzard');
    expect(conditionFromWeather({ tempC: -1, precipMm: 0.4, snowCm: 0.4, gustKmh: 10, code: 71 })).toBe('snow');
    expect(conditionFromWeather({ tempC: 0, precipMm: 0.6, snowCm: 0, gustKmh: 10, code: 61 })).toBe('ice');
    expect(conditionFromWeather({ tempC: 12, precipMm: 3, snowCm: 0, gustKmh: 30, code: 63 })).toBe('clear');

    const now = new Date();
    const fake = (async (url: string) => {
      const n = new URL(url).searchParams.get('latitude')!.split(',').length;
      const body = Array.from({ length: n }, (_, i) => ({ current: { temperature_2m: i === 0 ? -4 : 8, precipitation: i === 0 ? 1 : 0, snowfall: i === 0 ? 0.8 : 0, weather_code: i === 0 ? 73 : 1, wind_gusts_10m: 20 } }));
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    expect(await fetchWeather(db(), now, fake)).toBeGreaterThan(5);
    const [first] = await db().select().from(weatherNow).where(eq(weatherNow.condition, 'snow'));
    const real = await realConditions(db(), now);
    expect(real![first!.countryCode]).toBe('snow');
    // Old readings are not used.
    expect(await realConditions(db(), new Date(now.getTime() + 4 * 3_600_000))).toBeNull();
  });
});
