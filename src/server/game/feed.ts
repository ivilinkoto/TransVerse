import { and, desc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { companyMembers, feedCheers, feedEntries, organizations, users } from '@/server/db/schema';
import { rateLimit } from '@/server/auth/rate-limit';
import { fail } from './errors';
import { notify } from './notify';
import { circleOf } from './world-map';

export type FeedKind = 'level' | 'achievement' | 'trip' | 'mentor' | 'help' | 'project' | 'battle' | 'build';

/** Feed entries live this long. */
const KEEP_DAYS = 14;
/** The dashboard shows moments of the last days. */
const SHOW_DAYS = 3;

/** A notable moment of a player (userId) or a company (organizationId). */
export async function addFeed(tx: DbOrTx, entry: { userId?: string; organizationId?: string; kind: FeedKind; text: string }, now = new Date()) {
  await tx.insert(feedEntries).values({ userId: entry.userId ?? null, organizationId: entry.organizationId ?? null, kind: entry.kind, text: entry.text.slice(0, 200), createdAt: now });
}

/** What happened with the player's friends and company: newest first, with the "Браво" count. */
export async function friendsFeed(db: DbOrTx, userId: string, now = new Date(), limit = 12) {
  const circle = await circleOf(db, userId);
  const people = [...new Set([...circle.friends, ...circle.mates])];
  const [member] = await db.select({ companyId: companyMembers.companyId }).from(companyMembers).where(eq(companyMembers.userId, userId));
  const who = [people.length ? inArray(feedEntries.userId, people) : undefined, member ? eq(feedEntries.organizationId, member.companyId) : undefined].filter((x) => x !== undefined);
  if (!who.length) return [];
  const rows = await db
    .select({
      id: feedEntries.id,
      kind: feedEntries.kind,
      text: feedEntries.text,
      createdAt: feedEntries.createdAt,
      userId: feedEntries.userId,
      username: users.username,
      company: organizations.name,
      cheers: sql<number>`(select count(*)::int from ${feedCheers} c where c.entry_id = ${feedEntries}.id)`,
      cheered: sql<boolean>`exists (select 1 from ${feedCheers} c where c.entry_id = ${feedEntries}.id and c.user_id = ${userId})`,
    })
    .from(feedEntries)
    .leftJoin(users, eq(users.id, feedEntries.userId))
    .leftJoin(organizations, eq(organizations.id, feedEntries.organizationId))
    .where(and(or(...who), gte(feedEntries.createdAt, new Date(now.getTime() - SHOW_DAYS * 86_400_000))))
    .orderBy(desc(feedEntries.createdAt))
    .limit(limit);
  return rows;
}

/** "Браво": once per entry and player; the author hears about it. */
export async function cheer(db: Database, userId: string, entryId: string) {
  await rateLimit(db, `cheer:${userId}`, 30, 60);
  return db.transaction(async (tx) => {
    const [entry] = await tx.select().from(feedEntries).where(eq(feedEntries.id, entryId));
    if (!entry) fail('not_found', 'Събитието вече не е в лентата.', 404);
    if (entry!.userId === userId) fail('self', 'Не можеш да поздравиш сам себе си.');
    const [row] = await tx.insert(feedCheers).values({ entryId, userId }).onConflictDoNothing().returning();
    if (row && entry!.userId) {
      const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
      await notify(tx, entry!.userId, 'info', `${me!.username} те поздрави 👍`, entry!.text, '/game');
    }
    return { cheered: !!row };
  });
}

/** Worker: old moments are forgotten. */
export async function pruneFeed(db: DbOrTx, now = new Date()) {
  const gone = await db.delete(feedEntries).where(lt(feedEntries.createdAt, new Date(now.getTime() - KEEP_DAYS * 86_400_000))).returning({ id: feedEntries.id });
  return gone.length;
}

export const FEED_LONG_TRIP_KM = 500;
