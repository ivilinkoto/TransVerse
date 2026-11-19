/**
 * The team's polls, one set for Discord and the game. The team starts a poll with /анкета in
 * Discord or from the admin panel; players vote with the buttons in #анкети or on the game's
 * dashboard. A poll lives in job_state under `team-poll:<id>`.
 *
 * Votes are keyed by voter: `u:<userId>` for a game account (also a Discord voter whose account
 * is linked), `d:<discordId>` for a Discord member without a linked account. Polls from before
 * this keyed Discord votes by the bare Discord id — they count as `d:`.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { jobState, users } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { fail } from './errors';

export const TEAM_POLL_PREFIX = 'team-poll:';
export const TEAM_POLL = { questionMin: 5, questionMax: 200, optionMax: 80, minOptions: 2, maxOptions: 5, minHours: 1, maxHours: 168, keepDays: 365 } as const;

export interface TeamPoll {
  question: string;
  options: string[];
  votes: Record<string, number>;
  endsAt: number;
  /** Where the poll's message is in Discord (none when the game started it without Discord). */
  channelId: string | null;
  messageId: string | null;
  closed?: boolean;
  /** Where it was started and by whom (a game username or a Discord name). */
  source?: 'discord' | 'game';
  createdBy?: string;
  createdAt?: number;
}

export type TeamPollRow = TeamPoll & { id: string };

const keyOf = (id: string) => TEAM_POLL_PREFIX + id;
/** A Discord vote stored before voter keys had a prefix counts as a Discord vote. */
const fromDiscord = (voter: string) => voter.startsWith('d:') || !voter.startsWith('u:');

export const isOpen = (p: TeamPoll, now: Date) => !p.closed && now.getTime() < p.endsAt;

/** The counts per answer, all together and split by where the votes came from. */
export function tally(p: TeamPoll) {
  const all = p.options.map(() => 0);
  const game = p.options.map(() => 0);
  const discord = p.options.map(() => 0);
  for (const [voter, i] of Object.entries(p.votes)) {
    if (i < 0 || i >= p.options.length) continue;
    all[i]!++;
    (fromDiscord(voter) ? discord : game)[i]!++;
  }
  return { all, game, discord, total: all.reduce((a, b) => a + b, 0) };
}

/** Checks a new poll's text; returns the cleaned question and answers. */
export function cleanPoll(input: { question: string; options: string[]; hours: number }) {
  const question = input.question.trim().slice(0, TEAM_POLL.questionMax);
  const options = input.options.map((s) => s.trim().slice(0, TEAM_POLL.optionMax)).filter(Boolean);
  const hours = Math.round(input.hours);
  if (question.length < TEAM_POLL.questionMin) fail('too_short', t('Въпросът е твърде кратък.'));
  if (options.length < TEAM_POLL.minOptions || options.length > TEAM_POLL.maxOptions) fail('bad_options', t('Отговорите са от {0} до {1}.', TEAM_POLL.minOptions, TEAM_POLL.maxOptions));
  if (!(hours >= TEAM_POLL.minHours && hours <= TEAM_POLL.maxHours)) fail('bad_hours', t('Анкетата трае от {0} до {1} часа.', TEAM_POLL.minHours, TEAM_POLL.maxHours));
  return { question, options, hours };
}

/** Saves a new poll (its Discord message, if any, is posted by the caller first). */
export async function saveTeamPoll(db: DbOrTx, poll: TeamPoll, id: string = randomUUID().slice(0, 8)) {
  await db.insert(jobState).values({ key: keyOf(id), value: poll });
  return id;
}

export async function getTeamPoll(db: DbOrTx, id: string): Promise<TeamPoll | null> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, keyOf(id)));
  return (row?.value as TeamPoll | undefined) ?? null;
}

/** All polls, newest first. */
export async function allTeamPolls(db: DbOrTx): Promise<TeamPollRow[]> {
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(sql`${jobState.key} like ${TEAM_POLL_PREFIX + '%'}`);
  return rows
    .map((r) => ({ ...(r.value as TeamPoll), id: r.key.slice(TEAM_POLL_PREFIX.length) }))
    .sort((a, b) => (b.createdAt ?? b.endsAt) - (a.createdAt ?? a.endsAt));
}

/** The voter key of a Discord member: their game account when it is linked. */
export async function discordVoter(db: DbOrTx, discordId: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, discordId));
  return u ? `u:${u.id}` : `d:${discordId}`;
}

/** A vote (or a changed vote). Returns the poll as it is after the vote. */
export async function voteTeamPoll(db: Database, voter: string, id: string, index: number, now = new Date()) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(jobState).where(eq(jobState.key, keyOf(id))).for('update');
    const poll = row?.value as TeamPoll | undefined;
    if (!poll) fail('poll_not_found', t('Анкетата не е намерена.'), 404);
    if (!isOpen(poll!, now)) fail('poll_closed', t('Анкетата вече е приключила.'));
    if (!Number.isInteger(index) || index < 0 || index >= poll!.options.length) fail('bad_option', t('Няма такъв отговор.'));
    const next = { ...poll!, votes: { ...poll!.votes, [voter]: index } };
    await tx.update(jobState).set({ value: next, updatedAt: now }).where(eq(jobState.key, keyOf(id)));
    return next;
  });
}

/** The open polls a player has not answered yet (in the game, or in Discord with their linked account). */
export async function pollsToAnswer(db: DbOrTx, userId: string, now = new Date()) {
  const [me] = await db.select({ discordId: users.discordId }).from(users).where(eq(users.id, userId));
  const keys = [`u:${userId}`, ...(me?.discordId ? [`d:${me.discordId}`, me.discordId] : [])];
  return (await allTeamPolls(db)).filter((p) => isOpen(p, now) && !keys.some((k) => k in p.votes));
}

/** Ends a poll now (the team). Returns the poll as it is after. */
export async function endTeamPoll(db: DbOrTx, id: string, now = new Date()) {
  const poll = await getTeamPoll(db, id);
  if (!poll) fail('poll_not_found', t('Анкетата не е намерена.'), 404);
  const done = { ...poll!, closed: true, endsAt: Math.min(poll!.endsAt, now.getTime()) };
  await db.update(jobState).set({ value: done, updatedAt: now }).where(eq(jobState.key, keyOf(id)));
  return done;
}

/** Worker: marks the polls whose time is up as closed; returns them (Discord updates their messages). */
export async function closeDuePolls(db: DbOrTx, now = new Date()) {
  const closed: TeamPollRow[] = [];
  for (const p of await allTeamPolls(db)) {
    if (p.closed || now.getTime() < p.endsAt) continue;
    const { id, ...poll } = p;
    const done = { ...poll, closed: true };
    await db.update(jobState).set({ value: done, updatedAt: now }).where(eq(jobState.key, keyOf(id)));
    closed.push({ ...done, id });
  }
  // Ended polls stay a year for the results in the admin panel.
  await db.delete(jobState).where(sql`${jobState.key} like ${TEAM_POLL_PREFIX + '%'} and ${jobState.updatedAt} < ${new Date(now.getTime() - TEAM_POLL.keepDays * 86_400_000)}`);
  return closed;
}
