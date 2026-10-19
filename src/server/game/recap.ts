import { aliasedTable, and, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { yearWindow } from '@/lib/game/recap';
import type { DbOrTx } from '@/server/db/client';
import { membershipOf } from './membership';
import { achievements, cities, companies, contracts, deliveries, routes, users } from '@/server/db/schema';

/**
 * A player's year: trips of their own account completed in the calendar year
 * (their own driving and their hired drivers'), records, the favourite lane,
 * the friend they drove in convoy with most, the busiest month. Game data.
 */
export async function yearRecap(db: DbOrTx, userId: string, year: number) {
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!account) return null;
  const { from, to } = yearWindow(year);
  const mine = and(eq(deliveries.companyId, account.id), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, from), lt(deliveries.completedAt, to));
  const origin = aliasedTable(cities, 'origin');
  const dest = aliasedTable(cities, 'dest');
  const partner = aliasedTable(deliveries, 'partner');
  const partnerAccount = aliasedTable(companies, 'partner_account');
  const partnerUser = aliasedTable(users, 'partner_user');

  const [[totals], [longest], [lane], [countries], [convoy], [month], [ach], [me]] = await Promise.all([
    db
      .select({
        trips: sql<number>`count(*)::int`,
        km: sql<number>`coalesce(sum(${deliveries.emptyKm} + ${deliveries.loadedKm}), 0)::float`,
        tons: sql<number>`coalesce(sum(${contracts.weightTons}), 0)::float`,
        onTime: sql<number>`count(*) filter (where ${deliveries.late} = false)::int`,
        earnedCents: sql<number>`coalesce(sum(${deliveries.payoutCents}), 0)::bigint`,
      })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .where(mine),
    db
      .select({ from: origin.nameBg, to: dest.nameBg, goods: contracts.goods, km: deliveries.loadedKm })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .innerJoin(origin, eq(origin.id, contracts.originCityId))
      .innerJoin(dest, eq(dest.id, contracts.destCityId))
      .where(mine)
      .orderBy(desc(deliveries.loadedKm))
      .limit(1),
    db
      .select({ from: origin.nameBg, to: dest.nameBg, trips: sql<number>`count(*)::int` })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .innerJoin(origin, eq(origin.id, contracts.originCityId))
      .innerJoin(dest, eq(dest.id, contracts.destCityId))
      .where(mine)
      .groupBy(origin.nameBg, dest.nameBg)
      .orderBy(desc(sql`count(*)`))
      .limit(1),
    db
      .select({ n: sql<number>`count(distinct c)::int` })
      .from(deliveries)
      .innerJoin(routes, eq(routes.id, deliveries.routeId))
      .innerJoin(sql`lateral unnest(${routes.countries}) as c`, sql`true`)
      .where(mine),
    db
      .select({ username: partnerUser.username, trips: sql<number>`count(*)::int` })
      .from(deliveries)
      .innerJoin(partner, eq(partner.id, deliveries.convoyWith))
      .innerJoin(partnerAccount, eq(partnerAccount.id, partner.companyId))
      .innerJoin(partnerUser, eq(partnerUser.id, partnerAccount.ownerId))
      .where(and(mine, isNotNull(deliveries.convoyWith)))
      .groupBy(partnerUser.username)
      .orderBy(desc(sql`count(*)`))
      .limit(1),
    db
      .select({ month: sql<number>`extract(month from ${deliveries.completedAt} at time zone 'Europe/Sofia')::int`, trips: sql<number>`count(*)::int` })
      .from(deliveries)
      .where(mine)
      .groupBy(sql`1`)
      .orderBy(desc(sql`count(*)`))
      .limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(achievements).where(and(eq(achievements.userId, userId), gte(achievements.unlockedAt, from), lt(achievements.unlockedAt, to))),
    db.select({ username: users.username, level: users.level }).from(users).where(eq(users.id, userId)),
  ]);
  const trips = totals?.trips ?? 0;
  return {
    year,
    username: me?.username ?? '',
    level: me?.level ?? 1,
    company: (await membershipOf(db, userId))?.company.name ?? null,
    trips,
    km: Math.round(totals?.km ?? 0),
    tons: Math.round(totals?.tons ?? 0),
    onTimeShare: trips ? (totals?.onTime ?? 0) / trips : null,
    earnedCents: Number(totals?.earnedCents ?? 0),
    countries: countries?.n ?? 0,
    longest: longest ? { ...longest, km: Math.round(longest.km) } : null,
    lane: lane ?? null,
    convoy: convoy ?? null,
    month: month ? { month: month.month, trips: month.trips } : null,
    achievements: ach?.n ?? 0,
  };
}

export type YearRecap = NonNullable<Awaited<ReturnType<typeof yearRecap>>>;
