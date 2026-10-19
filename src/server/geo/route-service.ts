import polyline from '@mapbox/polyline';
import { and, eq, notLike } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { cities, routes } from '@/server/db/schema';
import { approximateProvider, configuredProvider, RoutingUnavailableError, type RouteProfile, type RoutingProvider } from './routing';

export type StoredRoute = typeof routes.$inferSelect;

let lastCall = 0;
/** Public routing instances ask for gentle use: at most ~1 request per second per process. */
async function throttle(minIntervalMs: number) {
  const wait = lastCall + minIntervalMs - Date.now();
  lastCall = Math.max(Date.now(), lastCall + minIntervalMs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Cached road route between two real cities. Uses the configured provider and
 * falls back to an explicit, labelled approximation when it is unavailable.
 * An approximation in the cache is upgraded once the real provider answers.
 */
export async function getRoute(db: DbOrTx, fromCityId: number, toCityId: number, profile: RouteProfile, provider: RoutingProvider = configuredProvider()): Promise<StoredRoute> {
  const [cached] = await db
    .select()
    .from(routes)
    .where(and(eq(routes.fromCityId, fromCityId), eq(routes.toCityId, toCityId), eq(routes.profile, profile)))
    .limit(1);
  if (cached && (cached.provider === provider.name || provider.name === 'approximate')) return cached;

  const [from] = await db.select().from(cities).where(eq(cities.id, fromCityId));
  const [to] = await db.select().from(cities).where(eq(cities.id, toCityId));
  if (!from || !to) throw new Error(`Unknown city ${fromCityId} or ${toCityId}`);
  const a = { lat: from.lat, lon: from.lon, country: from.countryCode };
  const b = { lat: to.lat, lon: to.lon, country: to.countryCode };

  let result;
  try {
    if (provider.name !== 'approximate') await throttle(Number(process.env.ROUTING_MIN_INTERVAL_MS ?? 1100));
    result = await provider.route(a, b, profile);
  } catch (error) {
    if (!(error instanceof RoutingUnavailableError)) throw error;
    if (cached) return cached;
    console.warn(`[routing] ${error.message} — using approximation for ${from.name} → ${to.name}`);
    result = await approximateProvider.route(a, b, profile);
  }

  const values = {
    fromCityId,
    toCityId,
    profile,
    provider: result.provider,
    distanceKm: result.distanceKm,
    durationS: result.durationS,
    hasToll: result.hasToll,
    borders: result.borders,
    countries: result.countries,
    geometry: result.geometry,
  };
  const [stored] = await db
    .insert(routes)
    .values(values)
    .onConflictDoUpdate({ target: [routes.fromCityId, routes.toCityId, routes.profile], set: { ...values, createdAt: new Date() } })
    .returning();
  return stored!;
}

/** Profile key of a route through stops (groupage): `truck:via:12-34`. */
const viaProfile = (profile: RouteProfile, via: number[]) => `${profile}:via:${via.join('-')}`;

/**
 * Road route from `fromCityId` to `toCityId` through the given cities, built
 * from the real routes of each leg (borders and distances add up, the
 * geometry is joined). It is stored like any route, so a contract can point
 * at it. Approximate when any leg is.
 */
export async function getRouteVia(db: DbOrTx, fromCityId: number, via: number[], toCityId: number, profile: RouteProfile, provider: RoutingProvider = configuredProvider()): Promise<StoredRoute & { legKms: number[] }> {
  const points = [fromCityId, ...via, toCityId];
  const legs: StoredRoute[] = [];
  for (let i = 0; i + 1 < points.length; i++) legs.push(await getRoute(db, points[i]!, points[i + 1]!, profile, provider));
  let offset = 0;
  const borders: StoredRoute['borders'] = [];
  const countries: string[] = [];
  const coords: [number, number][] = [];
  for (const leg of legs) {
    for (const b of leg.borders) borders.push({ ...b, km: b.km + offset });
    for (const c of leg.countries) if (countries.at(-1) !== c) countries.push(c);
    if (leg.geometry) coords.push(...polyline.decode(leg.geometry, 6).slice(coords.length ? 1 : 0));
    offset += leg.distanceKm;
  }
  const real = legs.every((l) => l.provider === legs[0]!.provider && l.geometry);
  const values = {
    fromCityId,
    toCityId,
    profile: viaProfile(profile, via),
    provider: real ? legs[0]!.provider : 'approximate',
    distanceKm: offset,
    durationS: legs.reduce((s, l) => s + l.durationS, 0),
    hasToll: legs.some((l) => l.hasToll),
    borders,
    countries: [...new Set(countries)],
    geometry: real ? polyline.encode(coords, 6) : null,
  };
  const [stored] = await db
    .insert(routes)
    .values(values)
    .onConflictDoUpdate({ target: [routes.fromCityId, routes.toCityId, routes.profile], set: values })
    .returning();
  // Where each leg ends along the whole route (the stops, then the destination).
  const legKms = legs.map((_, i) => legs.slice(0, i + 1).reduce((s, l) => s + l.distanceKm, 0));
  return { ...stored!, legKms };
}

/** Retries routing for cached approximations so they become real road routes over time. */
export async function upgradeApproximateRoutes(db: DbOrTx, limit = 5, provider: RoutingProvider = configuredProvider()): Promise<number> {
  if (provider.name === 'approximate') return 0;
  // Routes through stops are rebuilt from their legs when a contract needs them again.
  const pending = await db.select().from(routes).where(and(eq(routes.provider, 'approximate'), notLike(routes.profile, '%:via:%'))).limit(limit);
  let upgraded = 0;
  for (const r of pending) {
    const fresh = await getRoute(db, r.fromCityId, r.toCityId, r.profile as RouteProfile, provider);
    if (fresh.provider !== 'approximate') upgraded++;
  }
  return upgraded;
}
