import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { liveryFor } from './livery';
import { powerUnitModel, rentalBuyoutCents, trailerModel } from '@/lib/game/catalog';
import { resaleValueCents } from '@/lib/game/economy';
import type { Segment } from '@/lib/game/schedule';
import type { DbOrTx } from '@/server/db/client';
import { cities, companies, deliveries, depots, drivers, ledgerEntries, notifications, organizations, routes, seasonScores, trailers, users, vehicles, contracts } from '@/server/db/schema';
import { activeSeason } from './seasons';

const ageDays = (d: Date) => (Date.now() - d.getTime()) / 86_400_000;

export async function fleetView(db: DbOrTx, companyId: string) {
  const vs = await db.select().from(vehicles).where(and(eq(vehicles.companyId, companyId), isNull(vehicles.soldAt))).orderBy(vehicles.purchasedAt);
  const ts = await db.select().from(trailers).where(and(eq(trailers.companyId, companyId), isNull(trailers.soldAt))).orderBy(trailers.purchasedAt);
  const ds = await db.select().from(drivers).where(eq(drivers.companyId, companyId)).orderBy(drivers.hiredAt);
  const active = await db.select().from(deliveries).where(and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'in_progress')));
  const contractRows = active.length ? await db.select().from(contracts).where(inArray(contracts.id, active.map((a) => a.contractId))) : [];
  const rentedIds = vs.filter((v) => v.ownership === 'rented').map((v) => v.id);
  const rentalTrips = rentedIds.length
    ? await db.select({ vehicleId: deliveries.vehicleId, n: sql<number>`count(*)::int` }).from(deliveries).where(and(inArray(deliveries.vehicleId, rentedIds), eq(deliveries.status, 'completed'))).groupBy(deliveries.vehicleId)
    : [];
  const cityIds = [...new Set([...vs.map((v) => v.cityId), ...ts.map((t) => t.cityId), ...contractRows.flatMap((c) => [c.originCityId, c.destCityId])])];
  const cityRows = cityIds.length ? await db.select().from(cities).where(inArray(cities.id, cityIds)) : [];
  const cityMap = new Map(cityRows.map((c) => [c.id, c]));
  const contractMap = new Map(contractRows.map((c) => [c.id, c]));
  // The company livery paints the trucks that wear no special paint.
  const livery = await liveryFor(db, companyId);

  const vehiclesOut = vs.map((v) => {
    const model = powerUnitModel(v.modelId);
    const trailer = ts.find((t) => t.vehicleId === v.id) ?? null;
    const driver = ds.find((d) => d.vehicleId === v.id) ?? null;
    const coDriver = ds.find((d) => d.coVehicleId === v.id) ?? null;
    const delivery = active.find((a) => a.vehicleId === v.id) ?? null;
    const contract = delivery ? contractMap.get(delivery.contractId)! : null;
    return {
      ...v,
      color: livery && !v.livery && v.ownership !== 'rented' ? livery : v.color,
      model,
      city: cityMap.get(v.cityId)!,
      trailer: trailer ? { ...trailer, model: trailerModel(trailer.modelId) } : null,
      driver,
      coDriver,
      delivery: delivery && contract ? { ...delivery, schedule: delivery.schedule as Segment[], contract, origin: cityMap.get(contract.originCityId)!, destination: cityMap.get(contract.destCityId)! } : null,
      // Rented vehicles are not assets of the player.
      resaleCents: v.ownership === 'rented' ? 0 : resaleValueCents(model.priceCents, v.condition, ageDays(v.purchasedAt)),
      rental: v.ownership === 'rented' ? { trips: rentalTrips.find((r) => r.vehicleId === v.id)?.n ?? 0, buyoutCents: rentalBuyoutCents(v.modelId, trailer?.ownership === 'rented' ? trailer.modelId : null) } : null,
    };
  });
  const trailersOut = ts.map((t) => ({ ...t, model: trailerModel(t.modelId), city: cityMap.get(t.cityId)!, resaleCents: t.ownership === 'rented' ? 0 : resaleValueCents(trailerModel(t.modelId).priceCents, t.condition, ageDays(t.purchasedAt)) }));
  return { vehicles: vehiclesOut, trailers: trailersOut, drivers: ds };
}

export type FleetVehicle = Awaited<ReturnType<typeof fleetView>>['vehicles'][number];

export async function netWorthCents(db: DbOrTx, companyId: string): Promise<number> {
  const { vehicles: vs, trailers: ts } = await fleetView(db, companyId);
  const [company] = await db.select({ balance: companies.balanceCents }).from(companies).where(eq(companies.id, companyId));
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(depots).where(eq(depots.companyId, companyId));
  return (company?.balance ?? 0) + vs.reduce((s, v) => s + v.resaleCents, 0) + ts.reduce((s, t) => s + t.resaleCents, 0) + Math.max(0, n - 1) * 30_000_00;
}

export async function financeSummary(db: DbOrTx, companyId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const byCategory = await db
    .select({ category: ledgerEntries.category, total: sql<number>`sum(${ledgerEntries.amountCents})::bigint` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.companyId, companyId), gte(ledgerEntries.createdAt, since)))
    .groupBy(ledgerEntries.category);
  const daily = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${ledgerEntries.createdAt} at time zone 'Europe/Sofia'), 'YYYY-MM-DD')`,
      income: sql<number>`coalesce(sum(${ledgerEntries.amountCents}) filter (where ${ledgerEntries.amountCents} > 0 and ${ledgerEntries.category} <> 'starting_capital'), 0)::bigint`,
      expense: sql<number>`coalesce(-sum(${ledgerEntries.amountCents}) filter (where ${ledgerEntries.amountCents} < 0), 0)::bigint`,
    })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.companyId, companyId), gte(ledgerEntries.createdAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return {
    byCategory: byCategory.map((r) => ({ category: r.category, total: Number(r.total) })),
    daily: daily.map((d) => ({ day: d.day, income: Number(d.income), expense: Number(d.expense) })),
  };
}

export async function ledgerPage(db: DbOrTx, companyId: string, limit = 100) {
  return db.select().from(ledgerEntries).where(eq(ledgerEntries.companyId, companyId)).orderBy(desc(ledgerEntries.id)).limit(limit);
}

export async function latestNotifications(db: DbOrTx, userId: string, limit = 50) {
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.id)).limit(limit);
}

/** The player's company name (via membership), or the player as an independent driver. */
const playerLabel = sql<string>`coalesce((select o.name from company_members m join organizations o on o.id = m.company_id where m.user_id = ${users.id}), ${users.username} || ' · самостоятелен шофьор')`;

export type LeaderboardKind = 'season' | 'wealth' | 'deliveries' | 'companies';

/** Player companies ranked by development (level and experience from all members). */
export async function companyLeaderboard(db: DbOrTx, limit = 50) {
  return db
    .select({
      companyId: organizations.id,
      company: organizations.name,
      tag: organizations.tag,
      color: organizations.color,
      owner: users.username,
      ownerRole: users.role,
      ownerVipUntil: users.vipUntil,
      level: organizations.companyLevel,
      value: organizations.companyXp,
      members: sql<number>`(select count(*)::int from company_members m where m.company_id = ${organizations.id})`,
    })
    .from(organizations)
    .innerJoin(users, eq(users.id, organizations.ownerId))
    .orderBy(desc(organizations.companyXp), desc(organizations.foundedAt))
    .limit(limit);
}

export async function leaderboard(db: DbOrTx, kind: LeaderboardKind, limit = 50) {
  if (kind === 'season') {
    const season = await activeSeason(db);
    const rows = await db
      .select({ companyId: companies.id, company: playerLabel, owner: users.username, ownerRole: users.role, ownerVipUntil: users.vipUntil, level: users.level, value: seasonScores.points, deliveries: seasonScores.deliveries })
      .from(seasonScores)
      .innerJoin(companies, eq(companies.id, seasonScores.companyId))
      .innerJoin(users, eq(users.id, companies.ownerId))
      .where(eq(seasonScores.seasonId, season.id))
      .orderBy(desc(seasonScores.points))
      .limit(limit);
    return { season, rows };
  }
  if (kind === 'deliveries') {
    const rows = await db
      .select({ companyId: companies.id, company: playerLabel, owner: users.username, ownerRole: users.role, ownerVipUntil: users.vipUntil, level: users.level, value: companies.deliveries, deliveries: companies.deliveries })
      .from(companies)
      .innerJoin(users, eq(users.id, companies.ownerId))
      .orderBy(desc(companies.deliveries), desc(companies.totalKm))
      .limit(limit);
    return { season: null, rows };
  }
  // Wealth: balance plus depreciated fleet value, computed in SQL for ranking.
  const wealth = sql<number>`(${companies.balanceCents} + coalesce((select sum(v.purchase_price_cents * 0.65 * (0.4 + 0.6 * v.condition / 100)) from vehicles v where v.company_id = ${companies.id} and v.sold_at is null and v.ownership = 'owned'), 0))::bigint`;
  const rows = await db
    .select({
      companyId: companies.id,
      company: playerLabel,
      owner: users.username,
      ownerRole: users.role,
      ownerVipUntil: users.vipUntil,
      level: users.level,
      value: wealth,
      deliveries: companies.deliveries,
    })
    .from(companies)
    .innerJoin(users, eq(users.id, companies.ownerId))
    .orderBy(desc(wealth))
    .limit(limit);
  return { season: null, rows: rows.map((r) => ({ ...r, value: Number(r.value) })) };
}

export async function routeGeometries(db: DbOrTx, ids: number[]) {
  if (!ids.length) return new Map<number, { geometry: string | null; provider: string; distanceKm: number }>();
  const rows = await db.select({ id: routes.id, geometry: routes.geometry, provider: routes.provider, distanceKm: routes.distanceKm }).from(routes).where(inArray(routes.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}
