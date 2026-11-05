/**
 * 1.2.4 „Откъде идват играчите“: sign-ups per `?src=` source, and how many of
 * them stayed (seen in the last 7 days), reached level 3 and paid.
 */
import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { payments, users } from '@/server/db/schema';

export interface SourceRow { source: string; signups: number; last30: number; active: number; level3: number; paying: number }

export async function signupSources(db: DbOrTx, now: Date, limit = 100): Promise<SourceRow[]> {
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const month = new Date(now.getTime() - 30 * 86_400_000);
  const paid = db.selectDistinct({ userId: payments.userId }).from(payments).where(eq(payments.status, 'paid')).as('paid');
  const rows = await db
    .select({
      source: users.signupSource,
      signups: sql<number>`count(*)::int`,
      last30: sql<number>`count(*) filter (where ${users.createdAt} >= ${month})::int`,
      active: sql<number>`count(*) filter (where ${users.lastSeenAt} >= ${week})::int`,
      level3: sql<number>`count(*) filter (where ${users.level} >= 3)::int`,
      paying: sql<number>`count(${paid.userId})::int`,
    })
    .from(users)
    .leftJoin(paid, eq(paid.userId, users.id))
    .where(isNotNull(users.signupSource))
    .groupBy(users.signupSource)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows.map((r) => ({ ...r, source: r.source! }));
}
