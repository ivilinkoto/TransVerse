import { sql } from 'drizzle-orm';
import { UNREAD_CAP } from '@/lib/game/social';
import type { DbOrTx } from '@/server/db/client';
import { chatReads } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { membershipOf } from './membership';

/** The key of the player's company chat in chat_reads. */
export const companyKey = (organizationId: string) => `company:${organizationId}`;

/** How far the player has read a channel (global, trade or company:<id>): up to this message id. */
export async function markChannelRead(db: DbOrTx, userId: string, channel: string, lastId: number, now = new Date()) {
  if (!lastId) return;
  await db
    .insert(chatReads)
    .values({ userId, channel, lastReadId: lastId, updatedAt: now })
    .onConflictDoUpdate({ target: [chatReads.userId, chatReads.channel], set: { lastReadId: sql`greatest(${chatReads.lastReadId}, ${lastId})`, updatedAt: now } });
}

/**
 * New messages per chat tab since the player last read it (not their own,
 * not deleted, not from players they blocked), counted up to UNREAD_CAP.
 * Never opened: the last 24 hours (in the company: since joining).
 */
export async function chatUnread(db: DbOrTx, userId: string, now = new Date()): Promise<{ global: number; trade: number; company: number }> {
  const none = { global: 0, trade: 0, company: 0 };
  if (!(await featureFor(db, userId, 'chat_unread', now))) return none;
  const reads = await db.select().from(chatReads).where(sql`${chatReads.userId} = ${userId}`);
  const last = (key: string) => reads.find((r) => r.channel === key)?.lastReadId ?? null;
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const notBlocked = sql`user_id not in (select blocked_id from user_blocks where blocker_id = ${userId})`;
  const count = async (q: ReturnType<typeof sql>) => {
    const { rows } = await db.execute<{ n: number }>(sql`select count(*)::int as n from (${q} limit ${UNREAD_CAP}) s`);
    return Number(rows[0]?.n ?? 0);
  };
  const since = (key: string, from: Date) => {
    const id = last(key);
    return id !== null ? sql`id > ${id}` : sql`created_at > ${from}`;
  };
  const channel = (c: 'global' | 'trade') => count(sql`select 1 from chat_messages where channel = ${c} and ${since(c, dayAgo)} and user_id <> ${userId} and deleted_at is null and ${notBlocked}`);
  const m = await membershipOf(db, userId);
  const company = m
    ? count(sql`select 1 from company_messages where company_id = ${m.company.id} and ${since(companyKey(m.company.id), m.member.joinedAt > dayAgo ? m.member.joinedAt : dayAgo)} and user_id <> ${userId} and deleted_at is null and ${notBlocked}`)
    : Promise.resolve(0);
  const [g, t, c] = await Promise.all([channel('global'), channel('trade'), company]);
  return { global: g, trade: t, company: c };
}
