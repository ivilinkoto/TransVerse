import { and, desc, eq, gt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MUTE_OPTIONS, REPORT_REASONS } from '@/lib/game/moderation';
import { rateLimit } from '@/server/auth/rate-limit';
import type { Database, DbOrTx } from '@/server/db/client';
import { adminAudit, chatMessages, companyMessages, directMessages, reports, userBlocks, users } from '@/server/db/schema';
import { fail } from './errors';
import { notify } from './notify';

// ── Blocking ──────────────────────────────────────────────────────────────

export async function blockUser(db: Database, userId: string, targetId: string) {
  if (userId === targetId) fail('self', 'Не можеш да блокираш себе си.');
  await db.insert(userBlocks).values({ blockerId: userId, blockedId: targetId }).onConflictDoNothing();
}

export async function unblockUser(db: Database, userId: string, targetId: string) {
  await db.delete(userBlocks).where(and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, targetId)));
}

/** Players this player has blocked (their lines are hidden in every chat). */
export async function blockedIds(db: DbOrTx, userId: string): Promise<Set<string>> {
  const rows = await db.select({ id: userBlocks.blockedId }).from(userBlocks).where(eq(userBlocks.blockerId, userId));
  return new Set(rows.map((r) => r.id));
}

/** Whether either player blocked the other. */
export async function blockedEither(db: DbOrTx, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ x: userBlocks.blockerId })
    .from(userBlocks)
    .where(or(and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)), and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a))))
    .limit(1);
  return !!row;
}

export async function assertNotBlocked(db: DbOrTx, a: string, b: string) {
  if (await blockedEither(db, a, b)) fail('blocked', 'Не можеш да направиш това — един от вас е блокирал другия.', 403);
}

/** Muted players cannot write in any chat or send private messages. */
export async function assertNotMuted(db: DbOrTx, userId: string, now = new Date()) {
  const [u] = await db.select({ until: users.chatMutedUntil }).from(users).where(eq(users.id, userId));
  if (u?.until && u.until > now) fail('muted', `Не можеш да пишеш до ${u.until.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} (решение на модератор).`, 403);
}

export async function blockList(db: DbOrTx, userId: string) {
  return db.select({ id: users.id, username: users.username, at: userBlocks.createdAt }).from(userBlocks).innerJoin(users, eq(users.id, userBlocks.blockedId)).where(eq(userBlocks.blockerId, userId)).orderBy(desc(userBlocks.createdAt));
}

// ── Reports ───────────────────────────────────────────────────────────────

export const reportSchema = z.object({
  targetUserId: z.string().uuid(),
  kind: z.enum(['player', 'channel', 'company', 'dm']),
  messageId: z.coerce.number().int().positive().optional(),
  reason: z.enum(Object.keys(REPORT_REASONS) as [keyof typeof REPORT_REASONS, ...(keyof typeof REPORT_REASONS)[]]),
  details: z.string().trim().max(500).optional(),
});

/** A player reports another player, optionally a specific message (a copy of it is kept for the moderators). */
export async function reportPlayer(db: Database, reporterId: string, raw: z.input<typeof reportSchema>) {
  const input = reportSchema.parse(raw);
  if (input.targetUserId === reporterId) fail('self', 'Не можеш да докладваш себе си.');
  await rateLimit(db, `report:${reporterId}`, 10, 3600);
  let snippet: string | null = null;
  if (input.messageId && input.kind !== 'player') {
    const table = input.kind === 'channel' ? chatMessages : input.kind === 'company' ? companyMessages : null;
    if (table) {
      const [m] = await db.select({ body: table.body, userId: table.userId }).from(table).where(eq(table.id, input.messageId));
      if (!m || m.userId !== input.targetUserId) fail('message_not_found', 'Съобщението не е намерено.', 404);
      snippet = m!.body;
    } else {
      const [m] = await db.select({ body: directMessages.body, senderId: directMessages.senderId, recipientId: directMessages.recipientId }).from(directMessages).where(eq(directMessages.id, input.messageId));
      // Only a message the reporter received can be reported.
      if (!m || m.senderId !== input.targetUserId || m.recipientId !== reporterId) fail('message_not_found', 'Съобщението не е намерено.', 404);
      snippet = m!.body;
    }
  }
  const [row] = await db
    .insert(reports)
    .values({ reporterId, targetUserId: input.targetUserId, kind: input.kind, messageId: input.messageId ?? null, snippet, reason: input.reason, details: input.details || null })
    .returning({ id: reports.id });
  return row!.id;
}

export async function openReportCount(db: DbOrTx) {
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(reports).where(eq(reports.status, 'open'));
  return n;
}

export async function reportList(db: DbOrTx, status: string | undefined) {
  const rows = await db
    .select({
      report: reports,
      reporter: sql<string>`(select username from users where id = ${reports.reporterId})`,
      target: users.username,
      targetMutedUntil: users.chatMutedUntil,
      targetBanned: users.bannedAt,
      priorReports: sql<number>`(select count(*)::int from reports r2 where r2.target_user_id = ${reports.targetUserId})`,
    })
    .from(reports)
    .innerJoin(users, eq(users.id, reports.targetUserId))
    .where(status ? eq(reports.status, status) : undefined)
    .orderBy(desc(reports.createdAt))
    .limit(200);
  return rows;
}

export type ReportAction = 'dismiss' | 'warn' | 'delete_message' | 'mute_h24' | 'mute_d7';

/**
 * Staff decision on a report. Deleting removes the reported message; muting
 * stops the player writing for a while. Every decision is in the audit log.
 */
export async function resolveReport(db: Database, actor: { id: string }, reportId: string, action: ReportAction, now = new Date()) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(reports).where(eq(reports.id, reportId)).for('update');
    if (!r) fail('report_not_found', 'Докладът не е намерен.', 404);
    if (action === 'delete_message' && r!.messageId) {
      if (r!.kind === 'channel') await tx.update(chatMessages).set({ deletedAt: now, deletedBy: actor.id }).where(eq(chatMessages.id, r!.messageId));
      if (r!.kind === 'company') await tx.update(companyMessages).set({ deletedAt: now, deletedBy: actor.id }).where(eq(companyMessages.id, r!.messageId));
      if (r!.kind === 'dm') await tx.update(directMessages).set({ deletedAt: now }).where(eq(directMessages.id, r!.messageId));
    }
    if (action === 'mute_h24' || action === 'mute_d7') {
      const until = new Date(now.getTime() + MUTE_OPTIONS[action === 'mute_h24' ? 'h24' : 'd7'].ms);
      await tx.update(users).set({ chatMutedUntil: until }).where(eq(users.id, r!.targetUserId));
      await notify(tx, r!.targetUserId, 'warning', 'Ограничение в чата', `Заради нарушение на правилата не можеш да пишеш в чата и лични съобщения до ${until.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`, '/game/support');
    }
    if (action === 'warn') await notify(tx, r!.targetUserId, 'warning', 'Предупреждение от модератор', 'Получихме сигнал за твое поведение в играта. Моля, спазвай правилата — при повторно нарушение следва ограничение.', '/game/support');
    // Every open report about the same message is closed together.
    const same = r!.messageId ? and(eq(reports.kind, r!.kind), eq(reports.messageId, r!.messageId), eq(reports.status, 'open')) : eq(reports.id, r!.id);
    await tx.update(reports).set({ status: action === 'dismiss' ? 'dismissed' : 'resolved', resolution: action, resolvedBy: actor.id, resolvedAt: now }).where(same);
    await tx.insert(adminAudit).values({ actorId: actor.id, action: `report_${action}`, targetUserId: r!.targetUserId, details: { reportId, kind: r!.kind, messageId: r!.messageId } });
  });
}

/** Staff lift a mute early. */
export async function unmute(db: Database, actor: { id: string }, userId: string) {
  await db.update(users).set({ chatMutedUntil: null }).where(and(eq(users.id, userId), gt(users.chatMutedUntil, new Date(0))));
  await db.insert(adminAudit).values({ actorId: actor.id, action: 'unmute', targetUserId: userId, details: {} });
}
