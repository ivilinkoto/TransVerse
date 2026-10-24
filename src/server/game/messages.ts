import { and, desc, eq, gt, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { featureFor } from '@/server/features';
import { z } from 'zod';
import { isStaff } from '@/server/auth/roles';
import { rateLimit } from '@/server/auth/rate-limit';
import { CHANNELS, MESSAGE_MAX, REPLY_SNIPPET, isOnline, lastSeenLabel, type Channel, type ReactionSummary } from '@/lib/game/social';
import { isVip } from '@/lib/game/vip';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { chatMessages, companyMessages, directMessages, userBlocks, users } from '@/server/db/schema';
import { extractMentions } from '@/lib/game/mentions';
import { fail } from './errors';
import { assertNotBlocked, assertNotMuted } from './moderation';
import { notify } from './notify';
import { t as tr } from '@/i18n/t';

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
  /** The message this one answers (a short quote). */
  reply?: ReplyRef | null;
  reactions?: ReactionSummary[];
  /** Company chat: the author is in the game right now. */
  online?: boolean;
}

export interface ReplyRef {
  id: number;
  username: string;
  /** null when the original was deleted. */
  body: string | null;
}

// ── Replies ───────────────────────────────────────────────────────────────

type ReplyKind = 'channel' | 'company' | 'dm';
const REPLY_TABLES = {
  channel: { t: chatMessages, author: chatMessages.userId },
  company: { t: companyMessages, author: companyMessages.userId },
  dm: { t: directMessages, author: directMessages.senderId },
} as const;

/** The quoted originals of a page of messages (author and a short snippet). */
export async function replyRefs(db: DbOrTx, kind: ReplyKind, ids: (number | null)[]): Promise<Map<number, ReplyRef>> {
  const wanted = [...new Set(ids.filter((x): x is number => !!x))];
  if (!wanted.length) return new Map();
  const { t, author } = REPLY_TABLES[kind];
  const rows = await db.select({ id: t.id, body: t.body, deletedAt: t.deletedAt, username: users.username }).from(t).innerJoin(users, eq(users.id, author)).where(inArray(t.id, wanted));
  return new Map(rows.map((r) => [r.id, { id: r.id, username: r.username, body: r.deletedAt ? null : r.body.slice(0, REPLY_SNIPPET) }]));
}

/**
 * Checks what a new message answers: it must be in the same channel /
 * company / conversation (`scope`). Returns its author, or null without a reply.
 */
export async function replyTarget(tx: DbOrTx, kind: ReplyKind, replyToId: number | null | undefined, scope: SQL): Promise<{ id: number; userId: string } | null> {
  if (!replyToId) return null;
  const { t, author } = REPLY_TABLES[kind];
  const [row] = await tx.select({ id: t.id, userId: author, deletedAt: t.deletedAt }).from(t).where(and(eq(t.id, replyToId), scope));
  if (!row || row.deletedAt) fail('reply_not_found', tr('Съобщението, на което отговаряш, вече го няма.'), 404);
  return { id: row!.id, userId: row!.userId };
}

/** Tells the author of the answered message (not oneself, not if they blocked the replier or were already @mentioned). */
export async function notifyReply(tx: Tx, authorId: string, target: { userId: string } | null, body: string, where: { tab: string; where: string; mentioned: string[] }) {
  if (!target || target.userId === authorId) return;
  const [to] = await tx.select({ username: users.username, bannedAt: users.bannedAt }).from(users).where(eq(users.id, target.userId));
  if (!to || to.bannedAt || where.mentioned.includes(to.username)) return;
  const [blocked] = await tx.select({ id: userBlocks.blockerId }).from(userBlocks).where(and(eq(userBlocks.blockerId, target.userId), eq(userBlocks.blockedId, authorId)));
  if (blocked) return;
  const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, authorId));
  await notify(tx, target.userId, 'info', () => tr('{0} ти отговори в чата', me!.username), `${where.where}: ${body.slice(0, 140)}`, `/game?chat=${encodeURIComponent(where.tab)}`);
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
  const replies = await replyRefs(db, 'channel', rows.map((r) => r.m.replyToId));
  return rows.reverse().map((r) => ({ id: r.m.id, userId: r.m.userId, username: r.username, role: r.role, vip: isVip(r.vipUntil, now), body: r.m.deletedAt ? null : r.m.body, deleted: !!r.m.deletedAt, createdAt: r.m.createdAt.toISOString(), reply: r.m.replyToId ? (replies.get(r.m.replyToId) ?? null) : null }));
}

export async function postToChannel(db: Database, userId: string, channel: Channel, raw: string, replyToId?: number | null) {
  const body = messageBodySchema.parse(raw);
  await assertNotMuted(db, userId);
  await rateLimit(db, `channel:${channel}:${userId}`, CHANNELS[channel].perMinute, 60);
  return db.transaction(async (tx) => {
    const target = replyToId && (await featureFor(tx, userId, 'chat_replies')) ? await replyTarget(tx, 'channel', replyToId, eq(chatMessages.channel, channel)) : null;
    const [row] = await tx.insert(chatMessages).values({ channel, userId, body, replyToId: target?.id ?? null }).returning({ id: chatMessages.id });
    const mentioned = await notifyMentions(tx, userId, body, { tab: channel, where: CHANNELS[channel].label });
    await notifyReply(tx, userId, target, body, { tab: channel, where: CHANNELS[channel].label, mentioned });
    await ping(tx, { type: 'channel', channel });
    return row!.id;
  });
}

/** The author, or the support team, removes a message from a world channel. */
export async function deleteChannelMessage(db: Database, userId: string, role: string, messageId: number) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(chatMessages).where(eq(chatMessages.id, messageId)).for('update');
    if (!m) fail('message_not_found', tr('Съобщението не е намерено.'), 404);
    if (m!.userId !== userId && !isStaff(role)) fail('forbidden', tr('Можеш да триеш само свои съобщения.'), 403);
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
  for (const t of targets) await notify(tx, t.id, 'info', () => tr('{0} те спомена в чата', me!.username), `${where.where}: ${body.slice(0, 140)}`, `/game?chat=${encodeURIComponent(where.tab)}`);
  return targets.map((t) => t.username);
}

// ── Private messages ──────────────────────────────────────────────────────

const pair = (a: string, b: string) => or(and(eq(directMessages.senderId, a), eq(directMessages.recipientId, b)), and(eq(directMessages.senderId, b), eq(directMessages.recipientId, a)));
/** Messages the player has not hidden (by deleting the conversation). */
const visibleTo = (me: string) => or(and(eq(directMessages.senderId, me), eq(directMessages.hiddenForSender, false)), and(eq(directMessages.recipientId, me), eq(directMessages.hiddenForRecipient, false)));

export async function sendDirectMessage(db: Database, userId: string, toId: string, raw: string, now = new Date(), replyToId?: number | null) {
  const body = messageBodySchema.parse(raw);
  if (userId === toId) fail('self', tr('Не можеш да пишеш на себе си.'));
  await assertNotMuted(db, userId, now);
  await assertNotBlocked(db, userId, toId);
  await rateLimit(db, `dm:${userId}`, 20, 60);
  return db.transaction(async (tx) => {
    const [to] = await tx.select({ id: users.id, bannedAt: users.bannedAt, lastSeenAt: users.lastSeenAt }).from(users).where(eq(users.id, toId));
    if (!to || to.bannedAt) fail('player_not_found', tr('Играчът не е намерен.'), 404);
    const target = replyToId && (await featureFor(tx, userId, 'chat_replies', now)) ? await replyTarget(tx, 'dm', replyToId, and(pair(userId, toId), visibleTo(userId))!) : null;
    const [row] = await tx.insert(directMessages).values({ senderId: userId, recipientId: toId, body, replyToId: target?.id ?? null }).returning({ id: directMessages.id });
    // One notification per conversation while it is unread (not one per message), and only if they are not in the game.
    const [{ unread = 0 } = {}] = await tx.select({ unread: sql<number>`count(*)::int` }).from(directMessages).where(and(eq(directMessages.senderId, userId), eq(directMessages.recipientId, toId), isNull(directMessages.readAt), isNull(directMessages.deletedAt)));
    if (unread === 1 && !isOnline(to!.lastSeenAt, now)) {
      const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
      await notify(tx, toId, 'info', () => tr('Ново съобщение от {0}', me!.username), body.slice(0, 140), `/game?chat=dm:${userId}`);
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
  const replies = await replyRefs(db, 'dm', rows.map((r) => r.m.replyToId));
  return rows.reverse().map((r) => ({ id: r.m.id, userId: r.m.senderId, username: r.username, role: r.role, vip: isVip(r.vipUntil, now), body: r.m.deletedAt ? null : r.m.body, deleted: !!r.m.deletedAt, createdAt: r.m.createdAt.toISOString(), read: !!r.m.readAt, reply: r.m.replyToId ? (replies.get(r.m.replyToId) ?? null) : null }));
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
    if (!m || m.senderId !== userId) fail('message_not_found', tr('Можеш да триеш само свои съобщения.'), 404);
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
    return [{ userId: o.id, username: o.username, role: o.role, vip: isVip(o.vipUntil, now), online: isOnline(o.lastSeenAt, now), lastSeen: lastSeenLabel(o.lastSeenAt, now), unread: Number(r.unread), last: l ? (l.deletedAt ? tr('Съобщението е изтрито.') : `${l.senderId === userId ? tr('Ти: ') : ''}${l.body}`) : '' }];
  });
}

export async function unreadDirectCount(db: DbOrTx, userId: string) {
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(directMessages).where(and(eq(directMessages.recipientId, userId), isNull(directMessages.readAt), isNull(directMessages.deletedAt), eq(directMessages.hiddenForRecipient, false)));
  return n;
}
