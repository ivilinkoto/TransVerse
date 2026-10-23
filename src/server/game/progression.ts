import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import { LEDGER_LABELS, type LedgerCategory } from './finance';
import { addFeed } from './feed';
import { completeMentorship } from './mentor';
import { ACHIEVEMENTS, levelForXp, type CompanyStats } from '@/lib/game/progression';
import type { DbOrTx, Tx } from '@/server/db/client';
import { achievements, companies, deliveries, depots, drivers, cities, ledgerEntries, userBadges, users, vehicles, xpEntries } from '@/server/db/schema';
import { post } from './finance';
import { notify } from './notify';

export async function companyStats(db: DbOrTx, companyId: string): Promise<CompanyStats> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new Error('company not found');
  const [user] = await db.select({ level: users.level }).from(users).where(eq(users.id, company.ownerId));
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const vehiclesN = await count(db.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(and(eq(vehicles.companyId, companyId), isNull(vehicles.soldAt), ne(vehicles.ownership, 'company'))));
  const driversN = await count(db.select({ n: sql<number>`count(*)::int` }).from(drivers).where(eq(drivers.companyId, companyId)));
  const depotsN = await count(db.select({ n: sql<number>`count(*)::int` }).from(depots).where(eq(depots.companyId, companyId)));
  const countriesN = await count(
    db
      .select({ n: sql<number>`count(distinct ${cities.countryCode})::int` })
      .from(deliveries)
      .innerJoin(sql`contracts c`, sql`c.id = ${deliveries.contractId}`)
      .innerJoin(cities, sql`${cities.id} = c.dest_city_id`)
      .where(and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'completed'))),
  );
  const [maxReward] = await db
    .select({ n: sql<number>`coalesce(max(${deliveries.payoutCents}), 0)::bigint` })
    .from(deliveries)
    .where(eq(deliveries.companyId, companyId));
  const { rows: [trips] } = await db.execute<{ team: number; clean: number; cars: number; steel: number; tandem: number; night: number }>(sql`
    select
      count(*) filter (where d.co_driver_id is not null)::int as team,
      count(*) filter (where not coalesce(d.late, false) and cardinality(d.violations) = 0)::int as clean,
      count(*) filter (where c.cargo_type = 'vehicles')::int as cars,
      count(*) filter (where c.cargo_type = 'steel')::int as steel,
      coalesce(sum(c.weight_tons) filter (where t.model_id like 'drawbar-%'), 0)::float as tandem,
      count(*) filter (where extract(hour from d.completed_at at time zone 'Europe/Sofia') >= 22 or extract(hour from d.completed_at at time zone 'Europe/Sofia') < 6)::int as night
    from deliveries d
    join contracts c on c.id = d.contract_id
    left join trailers t on t.id = d.trailer_id
    where d.company_id = ${companyId} and d.status = 'completed'`);
  const { rows: [other] } = await db.execute<{ clients: number; appeals: number; insured: number; ghosts: number; star: boolean }>(sql`
    select
      (select count(*) from client_contracts where company_id = ${companyId} and status = 'completed')::int as clients,
      (select count(*) from fines where company_id = ${companyId} and status = 'dropped' and appealed)::int as appeals,
      (select count(*) from vehicles where company_id = ${companyId} and sold_at is null and insured_until > now())::int as insured,
      (select count(*) from coin_entries where user_id = ${company.ownerId} and idempotency_key like 'delivery:%:ghost')::int as ghosts,
      exists(select 1 from newspapers n, users u where u.id = ${company.ownerId} and (n.content -> 'topEarners' @> jsonb_build_array(jsonb_build_object('username', u.username)) or n.content -> 'topDrivers' @> jsonb_build_array(jsonb_build_object('username', u.username)))) as star`);
  return {
    teamTrips: trips?.team ?? 0,
    cleanTrips: trips?.clean ?? 0,
    carTrips: trips?.cars ?? 0,
    steelTrips: trips?.steel ?? 0,
    tandemTons: trips?.tandem ?? 0,
    nightTrips: trips?.night ?? 0,
    clientContracts: other?.clients ?? 0,
    appealsWon: other?.appeals ?? 0,
    insuredVehicles: other?.insured ?? 0,
    ghosts: other?.ghosts ?? 0,
    newsStar: !!other?.star,
    deliveries: company.deliveries,
    onTimeDeliveries: company.onTimeDeliveries,
    totalKm: company.totalKm,
    vehicles: vehiclesN,
    drivers: driversN,
    depots: depotsN,
    countriesServed: countriesN,
    level: user?.level ?? 1,
    balanceCents: company.balanceCents,
    maxSingleRewardCents: Number(maxReward?.n ?? 0),
  };
}

export type XpReason = 'delivery' | 'fleet' | 'mission' | 'event' | 'achievement' | 'daily' | 'tutorial' | 'roadside' | 'parking' | 'other';
export const XP_REASON_LABELS: Record<XpReason, string> = { delivery: 'Собствени курсове', fleet: 'Курсове на наети шофьори', mission: 'Мисии', event: 'Ивенти', achievement: 'Постижения', daily: 'Дневна награда', tutorial: 'Обучение', roadside: 'Помощ на пътя', parking: 'Мини-игра „Паркирай“', other: 'Други' };

/** Adds XP (logged with its source), recomputes the level and notifies on level-up. */
export async function awardXp(tx: Tx, userId: string, xp: number, reason: XpReason = 'other'): Promise<{ level: number; leveledUp: boolean }> {
  if (xp > 0) await tx.insert(xpEntries).values({ userId, amount: xp, reason });
  const [user] = await tx.update(users).set({ xp: sql`${users.xp} + ${xp}` }).where(eq(users.id, userId)).returning({ xp: users.xp, level: users.level });
  const level = levelForXp(user!.xp);
  if (level > user!.level) {
    await tx.update(users).set({ level }).where(eq(users.id, userId));
    await notify(tx, userId, 'achievement', `Ниво ${level}!`, 'Отключихте нови възможности. Вижте „Прогрес“.', '/game/progress');
    await completeMentorship(tx, userId, level);
    await addFeed(tx, { userId, kind: 'level', text: `достигна ниво ${level}` });
    return { level, leveledUp: true };
  }
  return { level, leveledUp: false };
}

/** Unlocks any newly earned achievements (exactly once each) and pays their rewards. */
export async function checkAchievements(tx: Tx, userId: string, companyId: string): Promise<string[]> {
  const stats = await companyStats(tx, companyId);
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!a.check(stats)) continue;
    const inserted = await tx.insert(achievements).values({ userId, key: a.key }).onConflictDoNothing().returning({ key: achievements.key });
    if (!inserted.length) continue;
    unlocked.push(a.key);
    if (a.rewardCents) await post(tx, companyId, [{ category: 'achievement_reward', amountCents: a.rewardCents, description: `Постижение: ${a.title}`, idempotencyKey: `achievement:${userId}:${a.key}` }]);
    if (a.rewardXp) await awardXp(tx, userId, a.rewardXp, 'achievement');
    if (a.badge) await tx.insert(userBadges).values({ userId, badge: a.badge }).onConflictDoNothing();
    await notify(tx, userId, 'achievement', `Постижение: ${a.title}`, a.description, '/game/progress');
    await addFeed(tx, { userId, kind: 'achievement', text: `спечели постижението „${a.title}“` });
  }
  return unlocked;
}

/** Admin: a player's XP over the last days, by source (largest first). */
export async function xpBySource(db: DbOrTx, userId: string, days = 7, now = new Date()) {
  const rows = await db
    .select({ reason: xpEntries.reason, xp: sql<number>`sum(${xpEntries.amount})::int`, n: sql<number>`count(*)::int` })
    .from(xpEntries)
    .where(and(eq(xpEntries.userId, userId), gte(xpEntries.createdAt, new Date(now.getTime() - days * 86_400_000))))
    .groupBy(xpEntries.reason);
  return rows.sort((a, b) => b.xp - a.xp).map((r) => ({ ...r, label: XP_REASON_LABELS[r.reason as XpReason] ?? r.reason }));
}

/** Admin: a player's money over the last days by ledger category (income and costs, largest first). */
export async function moneyBySource(db: DbOrTx, companyId: string, days = 7, now = new Date()) {
  const rows = await db
    .select({ category: ledgerEntries.category, cents: sql<number>`sum(${ledgerEntries.amountCents})::bigint`, n: sql<number>`count(*)::int` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.companyId, companyId), gte(ledgerEntries.createdAt, new Date(now.getTime() - days * 86_400_000))))
    .groupBy(ledgerEntries.category);
  return rows.map((r) => ({ ...r, cents: Number(r.cents), label: LEDGER_LABELS[r.category as LedgerCategory] ?? r.category })).sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
}
