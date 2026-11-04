/**
 * 1.2.3 „Твоята седмица“ (feature `week_chart`): trips and money per day for
 * the last 7 days (Sofia days), for the bars in the profile.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { sofiaDay } from '@/lib/game/shop-v2';
import type { DbOrTx } from '@/server/db/client';
import { deliveries } from '@/server/db/schema';

export interface WeekDay { day: string; trips: number; cents: number }

export async function weekChart(db: DbOrTx, companyId: string, now: Date): Promise<WeekDay[]> {
  const days = Array.from({ length: 7 }, (_, i) => sofiaDay(new Date(now.getTime() - (6 - i) * 86_400_000)));
  const since = new Date(now.getTime() - 8 * 86_400_000);
  const dayExpr = sql<string>`to_char(${deliveries.completedAt} at time zone 'Europe/Sofia', 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day: dayExpr, trips: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${deliveries.payoutCents}), 0)::bigint` })
    .from(deliveries)
    .where(and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, since)))
    .groupBy(dayExpr);
  const by = new Map(rows.map((r) => [r.day, r]));
  return days.map((day) => ({ day, trips: by.get(day)?.trips ?? 0, cents: Number(by.get(day)?.cents ?? 0) }));
}
