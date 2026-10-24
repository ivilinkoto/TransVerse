import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { REACTIONS, REPLY_SNIPPET, type Reaction, type ReactionSummary } from '@/lib/game/social';
import type { Database, DbOrTx } from '@/server/db/client';
import { chatMessages, chatReactions, companyMessages, directMessages, organizations, users } from '@/server/db/schema';
import { fail } from './errors';
import { membershipOf, requirePermission } from './membership';
import { blockedIds } from './moderation';
import { t } from '@/i18n/t';

export type ReactionKind = 'channel' | 'company' | 'dm';
const ping = (db: DbOrTx, payload: Record<string, unknown>) => db.execute(sql`select pg_notify('tv_events', ${JSON.stringify(payload)})`);

/** Which table a chat tab's messages live in. */
export const kindOfTab = (tab: string): ReactionKind => (tab === 'company' ? 'company' : tab.startsWith('dm:') ? 'dm' : 'channel');

/** Reactions of a page of messages, with whether the viewer reacted and the first few names. */
export async function reactionsFor(db: DbOrTx, kind: ReactionKind, ids: number[], viewerId: string): Promise<Map<number, ReactionSummary[]>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ messageId: chatReactions.messageId, emoji: chatReactions.emoji, userId: chatReactions.userId, username: users.username })
    .from(chatReactions)
    .innerJoin(users, eq(users.id, chatReactions.userId))
    .where(and(eq(chatReactions.kind, kind), inArray(chatReactions.messageId, ids)))
    .orderBy(chatReactions.createdAt);
  const out = new Map<number, ReactionSummary[]>();
  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    let item = list.find((x) => x.emoji === r.emoji);
    if (!item) {
      item = { emoji: r.emoji as Reaction, count: 0, mine: false, names: [] };
      list.push(item);
    }
    item.count++;
    if (r.userId === viewerId) item.mine = true;
    if (item.names.length < 8) item.names.push(r.username);
    out.set(r.messageId, list);
  }
  for (const list of out.values()) list.sort((a, b) => REACTIONS.indexOf(a.emoji) - REACTIONS.indexOf(b.emoji));
  return out;
}

/** Adds the reactions to messages of a feed. */
export async function withReactions<T extends { id: number }>(db: DbOrTx, kind: ReactionKind, messages: T[], viewerId: string): Promise<(T & { reactions: ReactionSummary[] })[]> {
  const map = await reactionsFor(db, kind, messages.map((m) => m.id), viewerId);
  return messages.map((m) => ({ ...m, reactions: map.get(m.id) ?? [] }));
}

/** Toggles a reaction on a message the player can see (same channel, their company or their conversation). */
export async function toggleReaction(db: Database, userId: string, tab: string, messageId: number, emoji: string) {
  if (!(REACTIONS as readonly string[]).includes(emoji)) fail('bad_reaction', t('Непозната реакция.'));
  const kind = kindOfTab(tab);
  let ok = false;
  let event: Record<string, unknown> = {};
  if (kind === 'channel') {
    const [m] = await db.select({ id: chatMessages.id, userId: chatMessages.userId }).from(chatMessages).where(and(eq(chatMessages.id, messageId), eq(chatMessages.channel, tab), sql`${chatMessages.deletedAt} is null`));
    ok = !!m && !(await blockedIds(db, userId)).has(m.userId);
    event = { type: 'channel', channel: tab };
  } else if (kind === 'company') {
    const member = await membershipOf(db, userId);
    const [m] = member ? await db.select({ id: companyMessages.id }).from(companyMessages).where(and(eq(companyMessages.id, messageId), eq(companyMessages.companyId, member.company.id), sql`${companyMessages.deletedAt} is null`)) : [];
    ok = !!m;
    event = { type: 'chat', companyId: member?.company.id };
  } else {
    const other = tab.slice(3);
    const [m] = await db
      .select({ id: directMessages.id })
      .from(directMessages)
      .where(and(eq(directMessages.id, messageId), sql`${directMessages.deletedAt} is null`, or(and(eq(directMessages.senderId, userId), eq(directMessages.recipientId, other)), and(eq(directMessages.senderId, other), eq(directMessages.recipientId, userId)))));
    ok = !!m;
    event = { type: 'dm', userId: other, fromId: userId };
  }
  if (!ok) fail('message_not_found', t('Съобщението не е намерено.'), 404);
  const removed = await db.delete(chatReactions).where(and(eq(chatReactions.kind, kind), eq(chatReactions.messageId, messageId), eq(chatReactions.userId, userId), eq(chatReactions.emoji, emoji))).returning({ id: chatReactions.messageId });
  if (!removed.length) await db.insert(chatReactions).values({ kind, messageId, userId, emoji }).onConflictDoNothing();
  await ping(db, event);
  return { on: !removed.length };
}

// ── Pinned message in the company chat ───────────────────────────────────

/** Pins a message on top of the company chat (or unpins with null). Ranks that run the chat. */
export async function pinCompanyMessage(db: Database, actorId: string, messageId: number | null) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_chat');
    if (messageId) {
      const [m] = await tx.select({ id: companyMessages.id }).from(companyMessages).where(and(eq(companyMessages.id, messageId), eq(companyMessages.companyId, actor.company.id), sql`${companyMessages.deletedAt} is null`));
      if (!m) fail('message_not_found', t('Съобщението не е намерено.'), 404);
    }
    await tx.update(organizations).set({ pinnedMessageId: messageId }).where(eq(organizations.id, actor.company.id));
    await tx.execute(sql`select pg_notify('tv_events', ${JSON.stringify({ type: 'chat', companyId: actor.company.id })})`);
  });
}

/** The pinned message of a company (author and text), if it is still there. */
export async function pinnedMessage(db: DbOrTx, organizationId: string) {
  const [row] = await db
    .select({ id: companyMessages.id, body: companyMessages.body, deletedAt: companyMessages.deletedAt, username: users.username })
    .from(organizations)
    .innerJoin(companyMessages, eq(companyMessages.id, organizations.pinnedMessageId))
    .innerJoin(users, eq(users.id, companyMessages.userId))
    .where(eq(organizations.id, organizationId));
  return row && !row.deletedAt ? { id: row.id, username: row.username, body: row.body.slice(0, REPLY_SNIPPET * 3) } : null;
}
