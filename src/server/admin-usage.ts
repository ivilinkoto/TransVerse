/**
 * Админ → Използване: what players really use, to decide what to keep. Two sources:
 * - what the game already records with a date — experience, ТрансКоин and money entries by
 *   their reason (each feature that pays something has its own) — for the last 30 days, at once;
 * - the pages players open (page-visits.ts), from the day this was added.
 * Players only (the staff are left out).
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { coinEntries, companies, ledgerEntries, users, xpEntries } from '@/server/db/schema';
import { pageUsage } from './page-visits';

export async function featureUsage(db: DbOrTx, now: Date, days = 30) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const players = db.select({ id: users.id }).from(users).where(eq(users.role, 'player'));
  const [xp, coins, money, [{ active = 0 } = {}], pages] = await Promise.all([
    db.select({ key: xpEntries.reason, players: sql<number>`count(distinct ${xpEntries.userId})::int` }).from(xpEntries).where(and(gte(xpEntries.createdAt, since), inArray(xpEntries.userId, players))).groupBy(xpEntries.reason),
    db.select({ key: coinEntries.reason, players: sql<number>`count(distinct ${coinEntries.userId})::int` }).from(coinEntries).where(and(gte(coinEntries.createdAt, since), inArray(coinEntries.userId, players))).groupBy(coinEntries.reason),
    db
      .select({ key: ledgerEntries.category, players: sql<number>`count(distinct ${companies.ownerId})::int` })
      .from(ledgerEntries)
      .innerJoin(companies, sql`${companies.id} = ${ledgerEntries.companyId}`)
      .where(and(gte(ledgerEntries.createdAt, since), inArray(companies.ownerId, players)))
      .groupBy(ledgerEntries.category),
    db.select({ active: sql<number>`count(*)::int` }).from(users).where(and(gte(users.lastSeenAt, since), inArray(users.id, players))),
    pageUsage(db, now, days),
  ]);
  const sort = (rows: { key: string; players: number }[]) => [...rows].sort((a, b) => b.players - a.players);
  return { days, active: Number(active), xp: sort(xp), coins: sort(coins), money: sort(money), pages };
}
