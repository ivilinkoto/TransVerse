import { and, desc, eq, gte, like, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { itemLog } from '@/server/db/schema';

/** 1.2.1 for the team: how many cases were opened, what came out (against the promised odds) and where items come from. */
export async function itemStats(db: DbOrTx, days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [opened, drops, sources] = await Promise.all([
    db.select({ caseId: itemLog.itemId, n: sql<number>`count(*)::int` }).from(itemLog).where(and(eq(itemLog.reason, 'case_open'), gte(itemLog.createdAt, since))).groupBy(itemLog.itemId),
    db
      .select({ reason: itemLog.reason, itemId: itemLog.itemId, n: sql<number>`sum(${itemLog.delta})::int` })
      .from(itemLog)
      .where(and(like(itemLog.reason, 'case:%'), gte(itemLog.createdAt, since)))
      .groupBy(itemLog.reason, itemLog.itemId)
      .orderBy(desc(sql`sum(${itemLog.delta})`)),
    db
      .select({ reason: itemLog.reason, n: sql<number>`sum(${itemLog.delta})::int` })
      .from(itemLog)
      .where(and(sql`${itemLog.delta} > 0`, gte(itemLog.createdAt, since)))
      .groupBy(itemLog.reason)
      .orderBy(desc(sql`sum(${itemLog.delta})`)),
  ]);
  return { opened, drops: drops.map((d) => ({ caseId: d.reason.slice(5), itemId: d.itemId, n: d.n })), sources, since };
}
