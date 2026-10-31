import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { cities, contracts, deliveries } from '@/server/db/schema';

/**
 * 1.1.4.2 „Къде печеля“: the net result of the last 30 days by destination
 * city, for the map (real coordinates of the cities).
 */
export async function earningsByCity(db: DbOrTx, companyId: string, now = new Date(), days = 30) {
  const since = new Date(now.getTime() - days * 86_400_000);
  return db
    .select({ cityId: cities.id, name: cities.nameBg, lat: cities.lat, lon: cities.lon, cents: sql<number>`coalesce(sum(${deliveries.payoutCents}), 0)::bigint`.mapWith(Number), trips: sql<number>`count(*)::int` })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, since)))
    .groupBy(cities.id, cities.nameBg, cities.lat, cities.lon)
    .orderBy(desc(sql`sum(${deliveries.payoutCents})`))
    .limit(60);
}
