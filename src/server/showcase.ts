import { aliasedTable, and, desc, eq, gt, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { AUCTION_RULES } from '@/lib/game/auctions';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { sofiaHour } from '@/lib/game/halloween';
import { sofiaMidnight } from '@/lib/game/missions';
import { ONLINE_MS } from '@/lib/game/social';
import { getDb } from '@/server/db/client';
import { cities, companies, contracts, countries, deliveries, globalEvents, ports, routes, seasons, specialAuctions, users } from '@/server/db/schema';
import { organizationSeasonTable } from '@/server/game/seasons';

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

const sofiaDate = (t: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t).split('-').map(Number) as [number, number, number];

/** Hour (Sofia) of the next special-load auction, and whether it is tomorrow. */
export function nextAuctionHour(now: Date): { hour: number; tomorrow: boolean } {
  const h = sofiaHour(now);
  const next = AUCTION_RULES.hours.find((x) => x > h);
  return next != null ? { hour: next, tomorrow: false } : { hour: AUCTION_RULES.hours[0], tomorrow: true };
}

/**
 * What is going on in the world right now, for the public page: game data
 * only (no player names except company names, which every player sees).
 */
export async function liveWorld(now = new Date()) {
  const db = getDb();
  const [y, m, d] = sofiaDate(now);
  const today = sofiaMidnight(y, m, d);
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const [counts] = await db
    .select({
      online: sql<number>`(select count(*) from ${users} where ${users.lastSeenAt} > ${new Date(now.getTime() - ONLINE_MS)})::int`,
      players: sql<number>`(select count(*) from ${users} where ${users.bannedAt} is null)::int`,
      deliveriesToday: sql<number>`(select count(*) from ${deliveries} where ${deliveries.status} = 'completed' and ${deliveries.completedAt} >= ${today})::int`,
      kmWeek: sql<number>`(select coalesce(sum(${deliveries.emptyKm} + ${deliveries.loadedKm}), 0) from ${deliveries} where ${deliveries.status} = 'completed' and ${deliveries.completedAt} >= ${week})::float`,
    })
    .from(sql`(select 1) as one`);

  const origin = aliasedTable(cities, 'origin');
  const dest = aliasedTable(cities, 'dest');
  const recent = await db
    .select({ id: deliveries.id, from: origin.nameBg, to: dest.nameBg, fromCountry: origin.countryCode, toCountry: dest.countryCode, goods: contracts.goods, cargo: contracts.cargoType, tons: contracts.weightTons, km: deliveries.loadedKm, at: deliveries.completedAt })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(origin, eq(origin.id, contracts.originCityId))
    .innerJoin(dest, eq(dest.id, contracts.destCityId))
    .where(and(eq(deliveries.status, 'completed'), lte(deliveries.completedAt, now)))
    .orderBy(desc(deliveries.completedAt))
    .limit(6);

  const [season] = await db.select().from(seasons).where(eq(seasons.status, 'active')).orderBy(desc(seasons.id)).limit(1);
  const top = season ? await organizationSeasonTable(db, season.id, 5) : [];

  const [event] = await db
    .select({ name: globalEvents.name, description: globalEvents.description, startsAt: globalEvents.startsAt, endsAt: globalEvents.endsAt, progress: globalEvents.progress, target: globalEvents.target, metric: globalEvents.metric })
    .from(globalEvents)
    .where(and(gt(globalEvents.endsAt, now), isNull(globalEvents.settledAt), isNull(globalEvents.outcome)))
    .orderBy(globalEvents.startsAt)
    .limit(1);

  const [auction] = await db
    .select({ title: specialAuctions.title, goods: specialAuctions.goods, tons: specialAuctions.weightTons, km: specialAuctions.distanceKm, coins: specialAuctions.coins, endsAt: specialAuctions.endsAt })
    .from(specialAuctions)
    .where(and(eq(specialAuctions.status, 'open'), lte(specialAuctions.startsAt, now), gte(specialAuctions.endsAt, now)))
    .limit(1);

  return {
    now,
    online: counts!.online,
    players: counts!.players,
    deliveriesToday: counts!.deliveriesToday,
    kmWeek: Math.round(counts!.kmWeek),
    recent: recent.map((r) => ({ ...r, cargoLabel: CARGO[r.cargo as CargoType]?.label ?? r.cargo })),
    season: season ? { name: season.name, endsAt: season.endsAt, top: top.map((t) => ({ name: t.name, tag: t.tag, color: t.color, points: t.points, members: t.members })) } : null,
    event: event ?? null,
    auction: auction ?? null,
    nextAuction: nextAuctionHour(now),
  };
}

export type LiveWorld = Awaited<ReturnType<typeof liveWorld>>;
