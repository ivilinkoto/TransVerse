import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { pollInputSchema, type PollInput } from '@/lib/game/polls';
import type { Database, DbOrTx } from '@/server/db/client';
import { companyPolls, companyPollVotes } from '@/server/db/schema';
import { fail } from './errors';
import { membershipOf, notifyMembers, requirePermission } from './membership';
import { logActivity } from './notify';

const openWhere = (organizationId: string, now: Date) => and(eq(companyPolls.organizationId, organizationId), isNull(companyPolls.closedAt), gt(companyPolls.closesAt, now));

/** Starts a poll in the company (ranks that run the chat); one may be open at a time. */
export async function createPoll(db: Database, actorId: string, input: PollInput, now = new Date()) {
  const data = pollInputSchema.parse(input);
  if (new Set(data.options.map((o) => o.toLowerCase())).size !== data.options.length) fail('duplicate_option', 'Отговорите трябва да са различни.');
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_chat');
    // Serialise the "one open poll" rule per company.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`poll:${actor.company.id}`}))`);
    const [open] = await tx.select({ id: companyPolls.id }).from(companyPolls).where(openWhere(actor.company.id, now));
    if (open) fail('poll_open', 'Вече има отворена анкета — изчакайте я или я затворете.');
    const [poll] = await tx.insert(companyPolls).values({ organizationId: actor.company.id, question: data.question, options: data.options, createdBy: actorId, closesAt: new Date(now.getTime() + data.hours * 3_600_000), createdAt: now }).returning();
    await notifyMembers(tx, actor.company.id, null, 'Нова анкета в компанията', data.question, '/game/company/chat');
    await logActivity(tx, actorId, 'company_poll', { pollId: poll!.id });
    return poll!;
  });
}

/** A member votes (again changes the vote) while the poll is open. */
export async function votePoll(db: Database, userId: string, pollId: string, option: number, now = new Date()) {
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId);
    if (!m) fail('not_member', 'Не членувате в компания.', 403);
    const [poll] = await tx.select().from(companyPolls).where(and(eq(companyPolls.id, pollId), eq(companyPolls.organizationId, m!.company.id)));
    if (!poll) fail('not_found', 'Няма такава анкета.', 404);
    if (poll!.closedAt || poll!.closesAt <= now) fail('poll_closed', 'Анкетата е затворена.');
    if (!Number.isInteger(option) || option < 0 || option >= poll!.options.length) fail('bad_option', 'Няма такъв отговор.');
    await tx
      .insert(companyPollVotes)
      .values({ pollId, userId, option, createdAt: now })
      .onConflictDoUpdate({ target: [companyPollVotes.pollId, companyPollVotes.userId], set: { option, createdAt: now } });
  });
}

/** Closes the open poll early. */
export async function closePoll(db: Database, actorId: string, pollId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const actor = await requirePermission(tx, actorId, 'manage_chat');
    const closed = await tx.update(companyPolls).set({ closedAt: now }).where(and(eq(companyPolls.id, pollId), openWhere(actor.company.id, now))).returning({ id: companyPolls.id });
    if (!closed.length) fail('not_found', 'Няма отворена анкета.', 404);
  });
}

export type PollView = Awaited<ReturnType<typeof companyPollsView>>[number];

/** The open poll and the last closed ones, with the votes and the viewer's own vote. */
export async function companyPollsView(db: DbOrTx, organizationId: string, viewerId: string, now = new Date()) {
  const polls = await db.select().from(companyPolls).where(eq(companyPolls.organizationId, organizationId)).orderBy(desc(companyPolls.createdAt)).limit(4);
  if (!polls.length) return [];
  const votes = await db
    .select({ pollId: companyPollVotes.pollId, option: companyPollVotes.option, n: sql<number>`count(*)::int`, mine: sql<boolean>`bool_or(${companyPollVotes.userId} = ${viewerId})` })
    .from(companyPollVotes)
    .where(sql`${companyPollVotes.pollId} in (${sql.join(polls.map((p) => sql`${p.id}`), sql`, `)})`)
    .groupBy(companyPollVotes.pollId, companyPollVotes.option);
  return polls.map((p) => {
    const own = votes.filter((v) => v.pollId === p.id);
    const counts = p.options.map((_, i) => own.find((v) => v.option === i)?.n ?? 0);
    return {
      id: p.id,
      question: p.question,
      options: p.options,
      counts,
      total: counts.reduce((a, b) => a + b, 0),
      myVote: own.find((v) => v.mine)?.option ?? null,
      open: !p.closedAt && p.closesAt > now,
      closesAt: p.closesAt,
    };
  });
}
