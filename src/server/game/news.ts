import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { fuelPriceCents } from '@/lib/game/fuel';
import { weekEndsAt, weekKey } from '@/lib/game/leagues';
import { headline, type NewsIssue } from '@/lib/game/news';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, cityMarkets, companies, companyMembers, contracts, countries, deliveries, globalEvents, marketEvents, newspapers, notifications, organizations, users } from '@/server/db/schema';

const DAY = 86_400_000;

/** Writes the issue for the week that starts at `key` (from what was delivered in it). */
export async function writeIssue(db: DbOrTx, key: string, now: Date): Promise<NewsIssue> {
  const to = weekEndsAt(key);
  const from = new Date(to.getTime() - 7 * DAY);
  const done = and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, from), lt(deliveries.completedAt, to));
  const [totals] = await db
    .select({
      deliveries: sql<number>`count(*)::int`,
      km: sql<number>`coalesce(sum(${deliveries.emptyKm} + ${deliveries.loadedKm}), 0)::float`,
      tons: sql<number>`coalesce(sum(${contracts.weightTons}), 0)::float`,
      players: sql<number>`count(distinct ${deliveries.companyId})::int`,
    })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(done);
  const [{ newPlayers = 0 } = {}] = await db.select({ newPlayers: sql<number>`count(*)::int` }).from(users).where(and(gte(users.createdAt, from), lt(users.createdAt, to)));

  const perPlayer = await db
    .select({ username: users.username, userId: users.id, net: sql<number>`coalesce(sum(${deliveries.payoutCents}), 0)::bigint`, trips: sql<number>`count(*)::int` })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(done, isNull(users.bannedAt)))
    .groupBy(users.id, users.username);
  const topEarners = [...perPlayer].sort((a, b) => Number(b.net) - Number(a.net)).slice(0, 5).map((p) => ({ username: p.username, value: Number(p.net) }));
  const topDrivers = [...perPlayer].sort((a, b) => b.trips - a.trips).slice(0, 5).map((p) => ({ username: p.username, value: p.trips }));

  const orgRows = await db
    .select({ name: organizations.name, tag: organizations.tag, n: sql<number>`count(*)::int` })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(companyMembers, eq(companyMembers.userId, companies.ownerId))
    .innerJoin(organizations, eq(organizations.id, companyMembers.companyId))
    .where(done)
    .groupBy(organizations.id, organizations.name, organizations.tag)
    .orderBy(desc(sql`count(*)`))
    .limit(3);

  const trip = (order: 'km' | 'reward') =>
    db
      .select({ username: users.username, km: deliveries.loadedKm, reward: contracts.rewardCents, goods: contracts.goods, originCityId: contracts.originCityId, destCityId: contracts.destCityId })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .innerJoin(companies, eq(companies.id, deliveries.companyId))
      .innerJoin(users, eq(users.id, companies.ownerId))
      .where(and(done, isNull(users.bannedAt), sql`${contracts.tradeCompanyId} is null`))
      .orderBy(desc(order === 'km' ? deliveries.loadedKm : contracts.rewardCents))
      .limit(1);
  const [[longTrip], [richTrip]] = await Promise.all([trip('km'), trip('reward')]);
  const cityIds = [longTrip, richTrip].flatMap((t) => (t ? [t.originCityId, t.destCityId] : []));
  const cityRows = cityIds.length ? await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, cityIds)) : [];
  const city = (id: number) => cityRows.find((c) => c.id === id)?.nameBg ?? '—';

  const countryRows = await db.select({ code: countries.code, nameBg: countries.nameBg }).from(countries);
  const prices = countryRows.map((c) => ({ country: c.nameBg, cents: fuelPriceCents(c.code, now) })).sort((a, b) => a.cents - b.cents);

  const demand = await db.select({ cargo: cityMarkets.cargoType, demand: sql<number>`avg(${cityMarkets.demand})::float` }).from(cityMarkets).where(eq(cityMarkets.consumes, true)).groupBy(cityMarkets.cargoType);
  const byDemand = [...demand].sort((a, b) => b.demand - a.demand);
  const label = (c: string) => CARGO[c as CargoType]?.label ?? c;

  const upcoming = await db
    .select({ name: globalEvents.name, startsAt: globalEvents.startsAt, endsAt: globalEvents.endsAt })
    .from(globalEvents)
    .where(and(isNull(globalEvents.settledAt), gt(globalEvents.endsAt, now), lte(globalEvents.startsAt, new Date(now.getTime() + 7 * DAY))))
    .orderBy(asc(globalEvents.startsAt))
    .limit(4);
  const events = await db.select({ title: marketEvents.title, endsAt: marketEvents.endsAt }).from(marketEvents).where(and(lte(marketEvents.startsAt, now), gt(marketEvents.endsAt, now))).limit(4);

  return {
    week: { key, from: from.toISOString(), to: to.toISOString() },
    totals: { deliveries: totals?.deliveries ?? 0, km: totals?.km ?? 0, tons: totals?.tons ?? 0, players: totals?.players ?? 0, newPlayers },
    topEarners,
    topDrivers,
    topCompanies: orgRows.map((o) => ({ name: o.name, tag: o.tag, deliveries: o.n })),
    longest: longTrip ? { username: longTrip.username, from: city(longTrip.originCityId), to: city(longTrip.destCityId), km: longTrip.km, goods: longTrip.goods } : null,
    richest: richTrip ? { username: richTrip.username, from: city(richTrip.originCityId), to: city(richTrip.destCityId), rewardCents: richTrip.reward, goods: richTrip.goods } : null,
    fuel: prices.length ? { cheapest: prices[0]!, dearest: prices.at(-1)! } : null,
    demand: { hot: byDemand[0] ? { cargo: label(byDemand[0].cargo), demand: byDemand[0].demand } : null, cold: byDemand.length > 1 ? { cargo: label(byDemand.at(-1)!.cargo), demand: byDemand.at(-1)!.demand } : null },
    upcoming: upcoming.map((e) => ({ name: e.name, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString() })),
    marketEvents: events.map((e) => ({ title: e.title, endsAt: e.endsAt.toISOString() })),
  };
}

/** Worker: publishes the issue of the week that just ended (once), and tells every player. */
export async function publishWeeklyNews(db: Database, now = new Date()) {
  const key = weekKey(new Date(now.getTime() - 7 * DAY));
  if (weekEndsAt(key) > now) return null;
  const [exists] = await db.select({ key: newspapers.weekKey }).from(newspapers).where(eq(newspapers.weekKey, key));
  if (exists) return null;
  const content = await writeIssue(db, key, now);
  return db.transaction(async (tx) => {
    const [{ last = 0 } = {}] = await tx.select({ last: sql<number>`coalesce(max(${newspapers.number}), 0)::int` }).from(newspapers);
    const [row] = await tx.insert(newspapers).values({ weekKey: key, number: last + 1, content, publishedAt: now }).onConflictDoNothing().returning();
    if (!row) return null;
    const title = `Седмичник TransVerse, брой ${row.number}`;
    await tx.execute(sql`insert into ${notifications} (user_id, kind, title, body, href) select ${users.id}, 'info', ${title}, ${headline(content)}, '/game/news' from ${users} where ${users.bannedAt} is null`);
    return row;
  });
}

export async function latestIssues(db: DbOrTx, limit = 12) {
  const rows = await db.select().from(newspapers).orderBy(desc(newspapers.number)).limit(limit);
  return rows.map((r) => ({ ...r, content: r.content as NewsIssue }));
}
