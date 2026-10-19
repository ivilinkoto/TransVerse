import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { featureFor } from '@/server/features';
import { z } from 'zod';
import { isStaff } from '@/server/auth/roles';
import { rateLimit } from '@/server/auth/rate-limit';
import { CHANNELS, MESSAGE_MAX, isOnline, lastSeenLabel, type Channel } from '@/lib/game/social';
import { isVip } from '@/lib/game/vip';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { chatMessages, directMessages, userBlocks, users } from '@/server/db/schema';
import { extractMentions } from '@/lib/game/mentions';
import { fail } from './errors';
import { assertNotBlocked, assertNotMuted } from './moderation';
import { notify } from './notify';

export const messageBodySchema = z.string().trim().min(1, 'Напиши съобщение.').max(MESSAGE_MAX, `Най-много ${MESSAGE_MAX} символа.`);

const ping = (tx: DbOrTx, payload: Record<string, unknown>) => tx.execute(sql`select pg_notify('tv_events', ${JSON.stringify(payload)})`);

export interface FeedMessage {
  id: number;
  userId: string;
  username: string;
  role: string;
  vip: boolean;
  body: string | null;
  deleted: boolean;
  createdAt: string;
  /** Private messages: the recipient has read it. */
  read?: boolean;
}

// ── World chat (global, trade) ───────────────────────────────────────────

export async function channelFeed(db: DbOrTx, channel: Channel, afterId = 0, limit = 60, now = new Date()): Promise<FeedMessage[]> {
  const rows = await db
    .select({ m: chatMessages, username: users.username, role: users.role, vipUntil: users.vipUntil })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .where(and(eq(chatMessages.channel, channel), afterId ? gt(chatMessages.id, afterId) : undefined))
    .orderBy(desc(chatMessages.id))
    .limit(Math.min(limit, 200));
  return rows.reverse().map((r) => ({ id: r.m.id, userId: r.m.userId, username: r.username, role: r.role, vip: isVip(r.vipUntil, now), body: r.m.deletedAt ? null : r.m.body, deleted: !!r.m.deletedAt, createdAt: r.m.createdAt.toISOString() }));
}

export async function postToChannel(db: Database, userId: string, channel: Channel, raw: string) {
  const body = messageBodySchema.parse(raw);
  await assertNotMuted(db, userId);
  await rateLimit(db, `channel:${channel}:${userId}`, CHANNELS[channel].perMinute, 60);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(chatMessages).values({ channel, userId, body }).returning({ id: chatMessages.id });
    await notifyMentions(tx, userId, body, { tab: channel, where: CHANNELS[channel].label });
    await ping(tx, { type: 'channel', channel });
    return row!.id;
  });
}

/** The author, or the support team, removes a message from a world channel. */
export async function deleteChannelMessage(db: Database, userId: string, role: string, messageId: number) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(chatMessages).where(eq(chatMessages.id, messageId)).for('update');
    if (!m) fail('message_not_found', 'Съобщението не е намерено.', 404);
    if (m!.userId !== userId && !isStaff(role)) fail('forbidden', 'Можеш да триеш само свои съобщения.', 403);
    await tx.update(chatMessages).set({ deletedAt: new Date(), deletedBy: userId }).where(eq(chatMessages.id, messageId));
    await ping(tx, { type: 'channel', channel: m!.channel });
  });
}

// ── Mentions ──────────────────────────────────────────────────────────────

/**
 * Tells the players mentioned with @name in a chat message. Not the author,
 * not banned players, not who blocked the author; in the company chat only
 * members (`members`). At most MENTION_MAX per message.
 */
export async function notifyMentions(tx: Tx, authorId: string, body: string, where: { tab: string; where: string; members?: string[] }) {
  const names = extractMentions(body);
  if (!names.length || !(await featureFor(tx, authorId, 'chat_extras'))) return [];
  const rows = await tx
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(and(inArray(sql`lower(${users.username})`, names), isNull(users.bannedAt), sql`${users.id} <> ${authorId}`, sql`not exists (select 1 from ${userBlocks} b where b.blocker_id = ${users}.id and b.blocked_id = ${authorId})`));
  const targets = where.members ? rows.filter((r) => where.members!.includes(r.id)) : rows;
  if (!targets.length) return [];
  const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, authorId));
  for (const t of targets) await notify(tx, t.id, 'info', `${me!.username} те спомена в чата`, `${where.where}: ${body.slice(0, 140)}`, `/game?chat=${encodeURIComponent(where.tab)}`);
  return targets.map((t) => t.username);
}

// ── Private messages ──────────────────────────────────────────────────────

const pair = (a: string, b: string) => or(and(eq(directMessages.senderId, a), eq(directMessages.recipientId, b)), and(eq(directMessages.senderId, b), eq(directMessages.recipientId, a)));
/** Messages the player has not hidden (by deleting the conversation). */
const visibleTo = (me: string) => or(and(eq(directMessages.senderId, me), eq(directMessages.hiddenForSender, false)), and(eq(directMessages.recipientId, me), eq(directMessages.hiddenForRecipient, false)));

export async function sendDirectMessage(db: Database, userId: string, toId: string, raw: string, now = new Date()) {
  const body = messageBodySchema.parse(raw);
  if (userId === toId) fail('self', 'Не можеш да пишеш на себе си.');
  await assertNotMuted(db, userId, now);
  await assertNotBlocked(db, userId, toId);
  await rateLimit(db, `dm:${userId}`, 20, 60);
  return db.transaction(async (tx) => {
    const [to] = await tx.select({ id: users.id, bannedAt: users.bannedAt, lastSeenAt: users.lastSeenAt }).from(users).where(eq(users.id, toId));
    if (!to || to.bannedAt) fail('player_not_found', 'Играчът не е намерен.', 404);
    const [row] = await tx.insert(directMessages).values({ senderId: userId, recipientId: toId, body }).returning({ id: directMessages.id });
    // One notification per conversation while it is unread (not one per message), and only if they are not in the game.
    const [{ unread = 0 } = {}] = await tx.select({ unread: sql<number>`count(*)::int` }).from(directMessages).where(and(eq(directMessages.senderId, userId), eq(directMessages.recipientId, toId), isNull(directMessages.readAt), isNull(directMessages.deletedAt)));
    if (unread === 1 && !isOnline(to!.lastSeenAt, now)) {
      const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
      await notify(tx, toId, 'info', `Ново съобщение от ${me!.username}`, body.slice(0, 140), `/game?chat=dm:${userId}`);
    }
    await ping(tx, { type: 'dm', userId: toId, fromId: userId });
    return row!.id;
  });
}

export async function conversation(db: DbOrTx, userId: string, otherId: string, afterId = 0, limit = 80, now = new Date()): Promise<FeedMessage[]> {
  const rows = await db
    .select({ m: directMessages, username: users.username, role: users.role, vipUntil: users.vipUntil })
    .from(directMessages)
    .innerJoin(users, eq(users.id, directMessages.senderId))
    .where(and(pair(userId, otherId), visibleTo(userId), afterId ? gt(directMessages.id, afterId) : undefined))
    .orderBy(desc(directMessages.id))
    .limit(Math.min(limit, 200));
  return rows.reverse().map((r) => ({ id: r.m.id, userId: r.m.senderId, username: r.username, role: r.role, vip: isVip(r.vipUntil, now), body: r.m.deletedAt ? null : r.m.body, deleted: !!r.m.deletedAt, createdAt: r.m.createdAt.toISOString(), read: !!r.m.readAt }));
}

export async function markConversationRead(db: DbOrTx, userId: string, otherId: string, now = new Date()) {
  const updated = await db
    .update(directMessages)
    .set({ readAt: now })
    .where(and(eq(directMessages.senderId, otherId), eq(directMessages.recipientId, userId), isNull(directMessages.readAt)))
    .returning({ id: directMessages.id });
  if (updated.length) await ping(db, { type: 'dm', userId: otherId, fromId: userId });
  return updated.length;
}

/** The sender takes a message back: removed for both players. */
export async function unsendDirectMessage(db: Database, userId: string, messageId: number) {
  return db.transaction(async (tx: Tx) => {
    const [m] = await tx.select().from(directMessages).where(eq(directMessages.id, messageId)).for('update');
    if (!m || m.senderId !== userId) fail('message_not_found', 'Можеш да триеш само свои съобщения.', 404);
    await tx.update(directMessages).set({ deletedAt: new Date() }).where(eq(directMessages.id, messageId));
    await ping(tx, { type: 'dm', userId: m!.recipientId, fromId: userId });
  });
}

/** Deletes the whole conversation for this player (the other player keeps their copy). */
export async function deleteConversation(db: Database, userId: string, otherId: string) {
  await db.update(directMessages).set({ hiddenForSender: true }).where(and(eq(directMessages.senderId, userId), eq(directMessages.recipientId, otherId)));
  await db.update(directMessages).set({ hiddenForRecipient: true, readAt: sql`coalesce(${directMessages.readAt}, now())` }).where(and(eq(directMessages.senderId, otherId), eq(directMessages.recipientId, userId)));
}

/** The player's conversations: partner, last message, unread count — newest first. */
export async function conversations(db: DbOrTx, userId: string, now = new Date()) {
  const { rows } = await db.execute<{ other_id: string; last_id: number; unread: number }>(sql`
    select case when sender_id = ${userId} then recipient_id else sender_id end as other_id,
           max(id) as last_id,
           count(*) filter (where recipient_id = ${userId} and read_at is null and deleted_at is null)::int as unread
    from direct_messages
    where (sender_id = ${userId} and not hidden_for_sender) or (recipient_id = ${userId} and not hidden_for_recipient)
    group by 1
    order by max(id) desc
    limit 30`);
  if (!rows.length) return [];
  const others = await db.select({ id: users.id, username: users.username, role: users.role, vipUntil: users.vipUntil, lastSeenAt: users.lastSeenAt }).from(users).where(inArray(users.id, rows.map((r) => r.other_id)));
  const last = await db.select({ id: directMessages.id, body: directMessages.body, senderId: directMessages.senderId, deletedAt: directMessages.deletedAt }).from(directMessages).where(inArray(directMessages.id, rows.map((r) => Number(r.last_id))));
  return rows.flatMap((r) => {
    const o = others.find((x) => x.id === r.other_id);
    const l = last.find((x) => x.id === Number(r.last_id));
    if (!o) return [];
    return [{ userId: o.id, username: o.username, role: o.role, vip: isVip(o.vipUntil, now), online: isOnline(o.lastSeenAt, now), lastSeen: lastSeenLabel(o.lastSeenAt, now), unread: Number(r.unread), last: l ? (l.deletedAt ? 'Съобщението е изтрито.' : `${l.senderId === userId ? 'Ти: ' : ''}${l.body}`) : '' }];
  });
}

export async function unreadDirectCount(db: DbOrTx, userId: string) {
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(directMessages).where(and(eq(directMessages.recipientId, userId), isNull(directMessages.readAt), isNull(directMessages.deletedAt), eq(directMessages.hiddenForRecipient, false)));
  return n;
}
