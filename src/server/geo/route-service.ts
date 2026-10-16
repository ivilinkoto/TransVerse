import { and, eq } from 'drizzle-orm';
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
