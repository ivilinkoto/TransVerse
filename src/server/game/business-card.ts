/**
 * 1.2.3.2 „Бизнес“ (feature `business_profile`): what a player earns from trips
 * and the fleet they run, on their profile and in a weekly ranking. Players can
 * hide it (Настройки → Поверителност); their own card always shows it to them.
 * Only trip income is shown — never the account balance.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { POWER_UNITS } from '@/lib/game/catalog';
import { weekEndsAt, weekKey } from '@/lib/game/leagues';
import type { DbOrTx } from '@/server/db/client';
import { companies, deliveries, trailers, users, vehicles } from '@/server/db/schema';
import { activeSeason } from './seasons';

/** The Monday 00:00 (Sofia) that starts the week of `now`. */
export const weekStartOf = (now: Date) => new Date(weekEndsAt(weekKey(now)).getTime() - 7 * 86_400_000);

const hiddenSql = sql`coalesce((${users.uiPrefs}->>'hideBusiness')::boolean, false)`;

export interface BusinessCard {
  hidden: boolean;
  week: { cents: number; trips: number };
  season: { cents: number; trips: number };
  total: { cents: number; trips: number };
  trucks: number;
  trailers: number;
  /** The most valuable own truck (model id). */
  topModel: string | null;
}

/** A player's business numbers (null: no account). */
export async function businessCard(db: DbOrTx, userId: string, now: Date): Promise<BusinessCard | null> {
  const [row] = await db.select({ accountId: companies.id, hidden: hiddenSql }).from(companies).innerJoin(users, eq(users.id, companies.ownerId)).where(eq(companies.ownerId, userId));
  if (!row) return null;
  const [season, weekStart] = [await activeSeason(db, now), weekStartOf(now)];
  const sum = (from?: Date) =>
    db
      .select({ cents: sql<number>`coalesce(sum(${deliveries.payoutCents}), 0)::float`, trips: sql<number>`count(*)::int` })
      .from(deliveries)
      .where(and(eq(deliveries.companyId, row.accountId), eq(deliveries.status, 'completed'), from ? gte(deliveries.completedAt, from) : undefined));
  const [[week], [inSeason], [total], fleet, [trailerCount]] = await Promise.all([
    sum(weekStart),
    sum(season.startsAt),
    sum(),
    db.select({ modelId: vehicles.modelId, ownership: vehicles.ownership }).from(vehicles).where(eq(vehicles.companyId, row.accountId)),
    db.select({ n: sql<number>`count(*)::int` }).from(trailers).where(eq(trailers.companyId, row.accountId)),
  ]);
  const price = (id: string) => POWER_UNITS.find((p) => p.id === id)?.priceCents ?? 0;
  const own = fleet.filter((v) => v.ownership === 'owned').sort((a, b) => price(b.modelId) - price(a.modelId));
  const n = (r: { cents: number; trips: number } | undefined) => ({ cents: Math.round(r?.cents ?? 0), trips: r?.trips ?? 0 });
  return { hidden: !!row.hidden, week: n(week), season: n(inSeason), total: n(total), trucks: fleet.length, trailers: trailerCount?.n ?? 0, topModel: own[0]?.modelId ?? null };
}

/** The players who earned the most from trips this week (players who hide their numbers are left out). */
export async function weeklyEarners(db: DbOrTx, now: Date, limit = 50) {
  const earned = sql<number>`coalesce(sum(${deliveries.payoutCents}), 0)::float`;
  const rows = await db
    .select({ userId: users.id, username: users.username, role: users.role, vipUntil: users.vipUntil, level: users.level, cents: earned, trips: sql<number>`count(*)::int` })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, weekStartOf(now)), sql`${hiddenSql} = false`))
    .groupBy(users.id)
    .orderBy(desc(earned))
    .limit(limit);
  return rows.map((r) => ({ ...r, cents: Math.round(r.cents) }));
}
