import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { cities, companies, contracts, countries, ports, routes } from '@/server/db/schema';

/** Real city pairs shown on the public page (GeoNames names, ISO codes). */
export const SHOWCASE_PAIRS: [string, string, string, string][] = [
  ['Sofia', 'BG', 'Plovdiv', 'BG'],
  ['Sofia', 'BG', 'Bucharest', 'RO'],
  ['Plovdiv', 'BG', 'Thessaloníki', 'GR'],
  ['Sofia', 'BG', 'Istanbul', 'TR'],
  ['Munich', 'DE', 'Vienna', 'AT'],
];

async function cityByName(name: string, country: string) {
  const db = getDb();
  const [city] = await db
    .select()
    .from(cities)
    .where(and(eq(cities.name, name), eq(cities.countryCode, country)))
    .orderBy(sql`${cities.population} desc`)
    .limit(1);
  return city;
}

export async function showcaseRoutes() {
  const db = getDb();
  const result = [];
  for (const [a, ac, b, bc] of SHOWCASE_PAIRS) {
    const from = await cityByName(a, ac);
    const to = await cityByName(b, bc);
    if (!from || !to) continue;
    const [route] = await db
      .select()
      .from(routes)
      .where(and(eq(routes.fromCityId, from.id), eq(routes.toCityId, to.id), eq(routes.profile, 'truck')));
    result.push({ from, to, route: route ?? null });
  }
  return result;
}

export async function publicStats() {
  const db = getDb();
  const [row] = await db
    .select({
      cities: sql<number>`(select count(*) from ${cities})::int`,
      countries: sql<number>`(select count(*) from ${countries})::int`,
      ports: sql<number>`(select count(*) from ${ports})::int`,
      hubs: sql<number>`(select count(distinct city_id) from city_markets)::int`,
      openContracts: sql<number>`(select count(*) from ${contracts} where ${contracts.status} = 'open' and ${contracts.expiresAt} > now())::int`,
      companies: sql<number>`(select count(*) from ${companies})::int`,
    })
    .from(sql`(select 1) as one`);
  return row!;
}

export async function countryNames(codes: string[]) {
  if (!codes.length) return new Map<string, string>();
  const rows = await getDb().select().from(countries).where(inArray(countries.code, codes));
  return new Map(rows.map((r) => [r.code, r.nameBg]));
}
