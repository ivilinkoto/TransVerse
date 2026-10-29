import { desc, eq, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { achievements, users } from '@/server/db/schema';

/**
 * 1.1.3.1: how rare each achievement is (the share of active players who have
 * it) and the players with the most of them („Колекционери“).
 */
export async function achievementRarity(db: DbOrTx): Promise<Map<string, number>> {
  const [{ players = 0 } = {}] = await db.select({ players: sql<number>`count(*)::int` }).from(users).where(isNull(users.bannedAt));
  const rows = await db.select({ key: achievements.key, n: sql<number>`count(*)::int` }).from(achievements).groupBy(achievements.key);
  return new Map(rows.map((r) => [r.key, players ? r.n / players : 0]));
}

export async function topCollectors(db: DbOrTx, limit = 10) {
  return db
    .select({ userId: users.id, username: users.username, n: sql<number>`count(${achievements.key})::int` })
    .from(achievements)
    .innerJoin(users, eq(users.id, achievements.userId))
    .where(isNull(users.bannedAt))
    .groupBy(users.id, users.username)
    .orderBy(desc(sql`count(${achievements.key})`), users.username)
    .limit(limit);
}
