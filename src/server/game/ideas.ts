import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, DbOrTx } from '@/server/db/client';
import { ideas, ideaVotes, users } from '@/server/db/schema';
import { fail } from './errors';
import { assertNotMuted } from './moderation';
import { logActivity, notify } from './notify';
import { isStaff } from '@/server/auth/roles';
import { recordAudit } from '@/server/admin';
import { t } from '@/i18n/t';
import { announceIdea, announceIdeaStatus } from '@/server/discord/announce';

/**
 * 1.1.4 „Идеи“: players suggest things for the game and vote for each other's
 * ideas (one vote each, not for one's own). The team marks an idea planned,
 * done or declined with a short answer (the author is told), or hides it.
 */
export const IDEAS = { perDay: 3, titleMax: 80, bodyMax: 600, minLevel: 2 } as const;
export const IDEA_STATUSES = ['open', 'planned', 'done', 'declined', 'hidden'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const ideaSchema = z.object({
  title: z.string().trim().min(5, 'Заглавието е поне 5 знака.').max(IDEAS.titleMax, 'Заглавието е до 80 знака.'),
  body: z.string().trim().max(IDEAS.bodyMax, 'Описанието е до 600 знака.').default(''),
});

export async function submitIdea(db: Database, userId: string, raw: z.input<typeof ideaSchema>, now = new Date()) {
  const input = ideaSchema.parse(raw);
  await assertNotMuted(db, userId, now);
  const [u] = await db.select({ level: users.level, username: users.username }).from(users).where(eq(users.id, userId));
  if (!u || u.level < IDEAS.minLevel) fail('level', t('Идеи се предлагат от ниво {0}.', IDEAS.minLevel));
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(ideas).where(and(eq(ideas.userId, userId), gte(ideas.createdAt, new Date(now.getTime() - 86_400_000))));
  if (n >= IDEAS.perDay) fail('too_many', t('До {0} идеи на ден — гласувай за чуждите междувременно.', IDEAS.perDay));
  const [row] = await db.insert(ideas).values({ userId, title: input.title, body: input.body, createdAt: now }).returning();
  await logActivity(db, userId, 'idea_submitted', { ideaId: row!.id });
  await announceIdea(db, row!, u!.username, now);
  return row!;
}

/** One vote per player and idea; the second click takes it back. */
export async function voteIdea(db: Database, userId: string, ideaId: string, source: 'game' | 'discord' = 'game') {
  return db.transaction(async (tx) => {
    const [idea] = await tx.select().from(ideas).where(eq(ideas.id, ideaId)).for('update');
    if (!idea || idea.status === 'hidden') fail('idea_not_found', t('Идеята не е намерена.'), 404);
    if (idea!.userId === userId) fail('own_idea', t('Не можеш да гласуваш за своя идея.'));
    if (idea!.status === 'done' || idea!.status === 'declined') fail('idea_closed', t('Гласуването за тази идея е приключило.'));
    const removed = await tx.delete(ideaVotes).where(and(eq(ideaVotes.ideaId, ideaId), eq(ideaVotes.userId, userId))).returning({ ideaId: ideaVotes.ideaId, source: ideaVotes.source });
    if (!removed.length) await tx.insert(ideaVotes).values({ ideaId, userId, source });
    // 1.1.3.4: the Discord votes are counted apart too (shown next to the total).
    const fromDiscord = removed.length ? (removed[0]!.source === 'discord' ? -1 : 0) : source === 'discord' ? 1 : 0;
    const [after] = await tx.update(ideas).set({ votes: sql`${ideas.votes} + ${removed.length ? -1 : 1}`, discordVotes: sql`${ideas.discordVotes} + ${fromDiscord}` }).where(eq(ideas.id, ideaId)).returning({ votes: ideas.votes });
    return { voted: !removed.length, votes: after!.votes };
  });
}

export async function ideaBoard(db: DbOrTx, viewerId: string, sort: 'top' | 'new' | 'planned', staff = false, limit = 60) {
  const where = sort === 'planned' ? inArray(ideas.status, ['planned', 'done']) : staff ? undefined : ne(ideas.status, 'hidden');
  const rows = await db
    .select({ idea: ideas, author: users.username })
    .from(ideas)
    .innerJoin(users, eq(users.id, ideas.userId))
    .where(where)
    .orderBy(sort === 'new' ? desc(ideas.createdAt) : desc(ideas.votes), desc(ideas.createdAt))
    .limit(limit);
  const ids = rows.map((r) => r.idea.id);
  const mine = ids.length ? new Set((await db.select({ id: ideaVotes.ideaId }).from(ideaVotes).where(and(eq(ideaVotes.userId, viewerId), inArray(ideaVotes.ideaId, ids)))).map((v) => v.id)) : new Set<string>();
  return rows.map((r) => ({ ...r.idea, author: r.author, votedByMe: mine.has(r.idea.id), mine: r.idea.userId === viewerId }));
}

const STATUS_TEXT: Record<IdeaStatus, string> = { open: 'отворена', planned: 'планирана', done: 'направена', declined: 'отхвърлена', hidden: 'скрита' };

/** Staff: a new status and an optional answer; the author hears about planned, done and declined. */
export async function setIdeaStatus(db: Database, actor: { id: string; role: string }, ideaId: string, status: IdeaStatus, note: string) {
  if (!isStaff(actor.role)) fail('forbidden', t('Само екипът променя статуса на идеите.'), 403);
  const [idea] = await db.update(ideas).set({ status, staffNote: note.trim().slice(0, 300) || null }).where(eq(ideas.id, ideaId)).returning();
  if (!idea) fail('idea_not_found', t('Идеята не е намерена.'), 404);
  await recordAudit(db, actor.id, 'idea_status', idea!.userId, { ideaId, status, title: idea!.title });
  if (status === 'planned' || status === 'done' || status === 'declined') {
    await announceIdeaStatus(db, idea!, status, note.trim());
    await notify(db, idea!.userId, status === 'declined' ? 'info' : 'success', () => t('Твоята идея е {0}', t(STATUS_TEXT[status])), () => (note.trim() ? t('„{0}“ — {1}', idea!.title, note.trim()) : t('„{0}“', idea!.title)), '/game/ideas');
  }
  return idea!;
}
