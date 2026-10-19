import { aliasedTable, and, desc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { achievements, cities, companies, contracts, deliveries } from '@/server/db/schema';

/**
 * A player's public career: totals, records, favourite lanes and the latest
 * trips (with their own trucks and hired drivers). Game data only — no money.
 */
export async function playerCareer(db: DbOrTx, userId: string) {
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!account) return null;
  const mine = and(eq(deliveries.companyId, account.id), eq(deliveries.status, 'completed'));
  const origin = aliasedTable(cities, 'origin');
  const dest = aliasedTable(cities, 'dest');
  const trip = () =>
    db
      .select({ id: deliveries.id, from: origin.nameBg, to: dest.nameBg, goods: contracts.goods, tons: contracts.weightTons, km: deliveries.loadedKm, late: deliveries.late, at: deliveries.completedAt })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .innerJoin(origin, eq(origin.id, contracts.originCityId))
      .innerJoin(dest, eq(dest.id, contracts.destCityId))
      .where(mine);

  const [[totals], [longest], [heaviest], lanes, recent, [ach]] = await Promise.all([
    db
      .select({
        trips: sql<number>`count(*)::int`,
        km: sql<number>`coalesce(sum(${deliveries.emptyKm} + ${deliveries.loadedKm}), 0)::float`,
        tons: sql<number>`coalesce(sum(${contracts.weightTons}), 0)::float`,
        onTime: sql<number>`count(*) filter (where ${deliveries.late} = false)::int`,
        countries: sql<number>`count(distinct ${dest.countryCode})::int`,
      })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .innerJoin(dest, eq(dest.id, contracts.destCityId))
      .where(mine),
    trip().orderBy(desc(deliveries.loadedKm)).limit(1),
    trip().orderBy(desc(contracts.weightTons), desc(deliveries.loadedKm)).limit(1),
    db
      .select({ from: origin.nameBg, to: dest.nameBg, trips: sql<number>`count(*)::int`, km: sql<number>`max(${deliveries.loadedKm})::float` })
      .from(deliveries)
      .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
      .innerJoin(origin, eq(origin.id, contracts.originCityId))
      .innerJoin(dest, eq(dest.id, contracts.destCityId))
      .where(mine)
      .groupBy(origin.nameBg, dest.nameBg)
      .orderBy(sql`count(*) desc`, sql`max(${deliveries.loadedKm}) desc`)
      .limit(5),
    trip().orderBy(desc(deliveries.completedAt)).limit(20),
    db.select({ n: sql<number>`count(*)::int` }).from(achievements).where(eq(achievements.userId, userId)),
  ]);
  return {
    trips: totals?.trips ?? 0,
    km: Math.round(totals?.km ?? 0),
    tons: Math.round(totals?.tons ?? 0),
    onTimeShare: totals?.trips ? (totals.onTime ?? 0) / totals.trips : null,
    countries: totals?.countries ?? 0,
    achievements: ach?.n ?? 0,
    longest: longest ?? null,
    heaviest: heaviest ?? null,
    lanes,
    recent,
  };
}

export type PlayerCareer = NonNullable<Awaited<ReturnType<typeof playerCareer>>>;
