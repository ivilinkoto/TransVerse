import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { cities, cityVisits, companies, contracts, deliveries, routes } from '@/server/db/schema';

/**
 * "Картата ми" (v1.6): the cities the player delivered to (the album's
 * visits) and the lanes they drove with a load, most driven first. The lane
 * lines are the stored routes (real roads); an approximated route has no
 * geometry and is drawn as a great circle.
 */
export async function footprint(db: DbOrTx, userId: string, maxLanes = 150) {
  const visited = await db
    .select({ id: cities.id, name: cities.nameBg, country: cities.countryCode, lat: cities.lat, lon: cities.lon, firstAt: cityVisits.firstAt })
    .from(cityVisits)
    .innerJoin(cities, eq(cities.id, cityVisits.cityId))
    .where(eq(cityVisits.userId, userId));
  const trips = sql<number>`count(*)::int`;
  const lanes = await db
    .select({
      routeId: deliveries.routeId,
      trips,
      km: sql<number>`max(${deliveries.loadedKm})::float`,
      geometry: routes.geometry,
      from: sql<string>`(select name_bg from cities where id = ${contracts.originCityId})`,
      to: sql<string>`(select name_bg from cities where id = ${contracts.destCityId})`,
      fromLat: sql<number>`(select lat from cities where id = ${contracts.originCityId})`,
      fromLon: sql<number>`(select lon from cities where id = ${contracts.originCityId})`,
      toLat: sql<number>`(select lat from cities where id = ${contracts.destCityId})`,
      toLon: sql<number>`(select lon from cities where id = ${contracts.destCityId})`,
    })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(routes, eq(routes.id, deliveries.routeId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed')))
    .groupBy(deliveries.routeId, routes.geometry, contracts.originCityId, contracts.destCityId)
    .orderBy(desc(trips))
    .limit(maxLanes);
  const [totals] = await db
    .select({ km: sql<number>`coalesce(sum(${deliveries.loadedKm} + ${deliveries.emptyKm}), 0)::float`, trips: sql<number>`count(*)::int` })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed')));
  return {
    cities: visited.map((c) => ({ name: c.name, country: c.country, position: [c.lat, c.lon] as [number, number] })),
    lanes: lanes.map((l) => ({ name: `${l.from} → ${l.to}`, trips: l.trips, km: Math.round(l.km), geometry: l.geometry, from: [l.fromLat, l.fromLon] as [number, number], to: [l.toLat, l.toLon] as [number, number] })),
    countries: new Set(visited.map((c) => c.country)).size,
    km: Math.round(totals?.km ?? 0),
    trips: totals?.trips ?? 0,
  };
}

export type Footprint = Awaited<ReturnType<typeof footprint>>;
