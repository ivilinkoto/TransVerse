/**
 * The automatic dispatcher: every now and then — at a random, never fixed,
 * interval — it publishes an urgent shipment between two real freight hubs,
 * mostly inside Bulgaria and light enough for a starter truck, so everyone has
 * a chance at it. Administrators can still publish their own.
 */
import { featureLive } from '@/lib/game/features';
import { plainGoodsFor } from '@/lib/game/goods';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { rewardCents } from '@/lib/game/economy';

/** How much an automatic urgent shipment pays, × a normal load of the same size. */
export const URGENT_PAY = [3, 4] as const;
import { isFreightHub } from '@/lib/game/markets';
import { gameDurationMinutes } from '@/lib/game/schedule';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database } from '@/server/db/client';
import { cities, contracts, deliveries, jobState } from '@/server/db/schema';
import { broadcast } from './notify';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { insertUrgent } from '@/server/urgent';
import { pick, pickWeighted, rand, randInt } from './random';

const KEY = 'auto-urgent';
/** Random pause between automatic shipments, minutes. */
export const AUTO_URGENT_GAP_MIN = { min: 90, max: 300 };
/** Never more than this many automatic shipments on the board at once. */
const MAX_OPEN = 2;

/** Cargo mix: mostly pallets (any starter truck can carry them). */
const CARGO_MIX: { cargo: CargoType; weight: number; tons: [number, number] }[] = [
  { cargo: 'pallets', weight: 60, tons: [1, 7] },
  { cargo: 'refrigerated', weight: 15, tons: [2, 7] },
  { cargo: 'bulk', weight: 15, tons: [14, 24] },
  { cargo: 'container', weight: 10, tons: [10, 22] },
];

const between = (min: number, max: number) => min + rand() * (max - min);

export const nextGapMs = () => randInt(AUTO_URGENT_GAP_MIN.min, AUTO_URGENT_GAP_MIN.max) * 60_000;

/** Publishes one automatic urgent shipment. Returns the contract, or null if no suitable pair was found. */
export async function publishAutoUrgent(db: Database, now = new Date(), provider?: RoutingProvider) {
  const hubs = (await db.select({ id: cities.id, nameBg: cities.nameBg, country: cities.countryCode, population: cities.population, lat: cities.lat, lon: cities.lon }).from(cities)).filter((c) => isFreightHub(c));
  // 80 % start in Bulgaria; the destination is 80–450 km away (a short, urgent run).
  const pool = rand() < 0.8 ? hubs.filter((c) => c.country === 'BG') : hubs;
  const origin = pickWeighted(pool, (c) => Math.sqrt(c.population));
  if (!origin) return null;
  const domestic = rand() < 0.75;
  const options = hubs.filter((c) => c.id !== origin.id && (!domestic || c.country === origin.country)).filter((c) => {
    const d = haversineKm([origin.lat, origin.lon], [c.lat, c.lon]);
    return d >= 80 && d <= 450;
  });
  const dest = pickWeighted(options, (c) => Math.sqrt(c.population));
  if (!dest) return null;
  const mix = pickWeighted(CARGO_MIX, (m) => m.weight)!;
  const tons = Math.round(between(mix.tons[0], mix.tons[1]) * 10) / 10;
  const route = await getRoute(db, origin.id, dest.id, 'truck', provider);
  const speedFactor = pick([1.5, 2, 2, 3]);
  const fastest = gameDurationMinutes(route.distanceKm) / speedFactor;
  const windowMinutes = Math.min(2880, Math.max(20, Math.ceil(fastest * 1.6) + 30));
  // Pays three to four times a normal job of the same size (urgent work is worth it).
  const reward = Math.round((rewardCents(mix.cargo, tons, route.distanceKm, 1) * between(URGENT_PAY[0], URGENT_PAY[1])) / 1000) * 1000;
  return db.transaction((tx) =>
    insertUrgent(
      tx,
      {
        goods: pick(plainGoodsFor(mix.cargo, featureLive('more_goods', now))),
        cargoType: mix.cargo,
        weightTons: tons,
        originCityId: origin.id,
        destCityId: dest.id,
        routeId: route.id,
        distanceKm: route.distanceKm,
        rewardCents: reward,
        windowMinutes,
        speedFactor,
        expiresAt: new Date(now.getTime() + randInt(120, 300) * 60_000),
        createdBy: null,
      },
      { from: origin.nameBg, to: dest.nameBg },
      'active',
    ),
  );
}

/** Worker: publishes a shipment when the random moment has come, then picks the next moment. */
export async function autoUrgentTick(db: Database, now = new Date(), provider?: RoutingProvider) {
  const [state] = await db.select().from(jobState).where(eq(jobState.key, KEY));
  const next = (state?.value as { next?: number } | undefined)?.next;
  const save = (at: number) => db.insert(jobState).values({ key: KEY, value: { next: at } }).onConflictDoUpdate({ target: jobState.key, set: { value: { next: at }, updatedAt: now } });
  // First run after a deploy: wait a random while instead of publishing at once.
  if (!next) return void (await save(now.getTime() + nextGapMs() / 2));
  if (now.getTime() < next) return;
  const [{ open = 0 } = {}] = await db
    .select({ open: sql<number>`count(*)::int` })
    .from(contracts)
    .where(and(eq(contracts.urgent, true), isNull(contracts.createdBy), eq(contracts.status, 'open'), gt(contracts.expiresAt, now)));
  let published = null;
  if (open < MAX_OPEN) {
    try {
      published = await publishAutoUrgent(db, now, provider);
    } catch (error) {
      console.error('[auto-urgent] could not publish', error);
    }
  }
  await save(now.getTime() + nextGapMs());
  return published;
}

/** Urgent price rises (v1.5): +10 % for every 30 minutes nobody has taken it, up to +50 %. */
export const URGENT_RAISE = { everyMin: 30, step: 0.1, max: 5 } as const;

/** Worker: raises the pay of urgent shipments that wait on the board without a taker. */
export async function raiseUrgentPrices(db: Database, now = new Date()) {
  const open = await db.select().from(contracts).where(and(eq(contracts.urgent, true), eq(contracts.status, 'open'), gt(contracts.expiresAt, now)));
  let raised = 0;
  for (const c of open) {
    const steps = Math.min(URGENT_RAISE.max, Math.floor((now.getTime() - c.createdAt.getTime()) / (URGENT_RAISE.everyMin * 60_000)));
    if (steps <= c.urgentRaises) continue;
    const [taken] = await db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.contractId, c.id)).limit(1);
    if (taken) continue;
    const reward = Math.round((c.rewardCents * (1 + URGENT_RAISE.step * steps)) / (1 + URGENT_RAISE.step * c.urgentRaises) / 100) * 100;
    const [row] = await db.update(contracts).set({ rewardCents: reward, urgentRaises: steps }).where(and(eq(contracts.id, c.id), eq(contracts.urgentRaises, c.urgentRaises))).returning({ id: contracts.id });
    if (row) raised++;
  }
  if (raised) await broadcast(db, 'market');
  return raised;
}
