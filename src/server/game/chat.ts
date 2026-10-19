import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isVip } from '@/lib/game/vip';
import { rateLimit } from '@/server/auth/rate-limit';
import type { Database, DbOrTx } from '@/server/db/client';
import { companyMembers, companyMessages, companyRanks, users } from '@/server/db/schema';
import { fail } from './errors';
import { assertNotMuted } from './moderation';
import { can, membershipOf } from './membership';
import { notifyMentions } from './messages';
import { logActivity } from './notify';

export const chatBodySchema = z.string().trim().min(1, 'Напишете съобщение.').max(500, 'Най-много 500 символа.');

export interface ChatMessage {
  id: number;
  userId: string;
  username: string;
  role: string;
  vip: boolean;
  rank: string | null;
  body: string | null;
  deleted: boolean;
  createdAt: string;
}

/** Latest messages of the player's company (oldest first), or only those after `afterId`. */
export async function companyChat(db: DbOrTx, userId: string, afterId = 0, limit = 60, now = new Date()): Promise<{ messages: ChatMessage[]; canModerate: boolean; canClear: boolean }> {
  const m = await membershipOf(db, userId);
  if (!m) fail('not_member', 'Чатът е само за членове на компанията.', 403);
  const rows = await db
    .select({ message: companyMessages, username: users.username, role: users.role, vipUntil: users.vipUntil, rank: companyRanks.name })
    .from(companyMessages)
    .innerJoin(users, eq(users.id, companyMessages.userId))
    .leftJoin(companyMembers, and(eq(companyMembers.userId, companyMessages.userId), eq(companyMembers.companyId, companyMessages.companyId)))
    .leftJoin(companyRanks, eq(companyRanks.id, companyMembers.rankId))
    .where(and(eq(companyMessages.companyId, m!.company.id), afterId ? gt(companyMessages.id, afterId) : undefined))
    .orderBy(desc(companyMessages.id))
    .limit(Math.min(limit, 200));
  return {
    canModerate: can(m!.rank, 'manage_members') || can(m!.rank, 'manage_chat'),
    canClear: can(m!.rank, 'manage_chat'),
    messages: rows.reverse().map((r) => ({
      id: r.message.id,
      userId: r.message.userId,
      username: r.username,
      role: r.role,
      vip: isVip(r.vipUntil, now),
      rank: r.rank,
      body: r.message.deletedAt ? null : r.message.body,
      deleted: !!r.message.deletedAt,
      createdAt: r.message.createdAt.toISOString(),
    })),
  };
}

/** Posts a message to the player's company chat and wakes the other members' chat windows. */
export async function sendChatMessage(db: Database, userId: string, raw: string) {
  const body = chatBodySchema.parse(raw);
  const m = await membershipOf(db, userId);
  if (!m) fail('not_member', 'Чатът е само за членове на компанията.', 403);
  await assertNotMuted(db, userId);
  // Anti-spam: at most 10 messages a minute per player.
  await rateLimit(db, `chat:${userId}`, 10, 60);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(companyMessages).values({ companyId: m!.company.id, userId, body }).returning({ id: companyMessages.id });
    if (body.includes('@')) {
      const members = (await tx.select({ id: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.companyId, m!.company.id))).map((r) => r.id);
      await notifyMentions(tx, userId, body, { tab: 'company', where: `Чат на „${m!.company.name}“`, members });
    }
    await tx.execute(sql`select pg_notify('tv_events', ${JSON.stringify({ type: 'chat', companyId: m!.company.id })})`);
    return row!.id;
  });
}

/** The author, or a member with "manage members" or "chat" rights, hides a message. */
export async function deleteChatMessage(db: Database, userId: string, messageId: number) {
  const m = await membershipOf(db, userId);
  if (!m) fail('not_member', 'Чатът е само за членове на компанията.', 403);
  return db.transaction(async (tx) => {
    const [msg] = await tx.select().from(companyMessages).where(and(eq(companyMessages.id, messageId), eq(companyMessages.companyId, m!.company.id))).for('update');
    if (!msg) fail('message_not_found', 'Съобщението не е намерено.', 404);
    if (msg!.userId !== userId && !can(m!.rank, 'manage_members') && !can(m!.rank, 'manage_chat')) fail('forbidden', 'Можете да триете само свои съобщения.', 403);
    await tx.update(companyMessages).set({ deletedAt: new Date(), deletedBy: userId }).where(eq(companyMessages.id, messageId));
    await tx.execute(sql`select pg_notify('tv_events', ${JSON.stringify({ type: 'chat', companyId: m!.company.id })})`);
  });
}

/** The owner, the deputy (or any rank with chat rights) clears the whole company chat. */
export async function clearCompanyChat(db: Database, userId: string) {
  const m = await membershipOf(db, userId);
  if (!m) fail('not_member', 'Чатът е само за членове на компанията.', 403);
  if (!can(m!.rank, 'manage_chat')) fail('forbidden', 'Само собственикът и заместникът могат да изчистят чата.', 403);
  return db.transaction(async (tx) => {
    const removed = await tx.delete(companyMessages).where(eq(companyMessages.companyId, m!.company.id)).returning({ id: companyMessages.id });
    await logActivity(tx, userId, 'company_chat_cleared', { companyId: m!.company.id, messages: removed.length });
    await tx.execute(sql`select pg_notify('tv_events', ${JSON.stringify({ type: 'chat', companyId: m!.company.id })})`);
    return removed.length;
  });
}
