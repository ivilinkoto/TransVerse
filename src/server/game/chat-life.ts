/**
 * 1.2.6 „На една вълна“: the game speaks in the chat. Lines from the game
 * (moments, partner loads, projects) by the „TransVerse“ author, a question
 * every evening with pass points for the first answers, and a thank-you from
 * new players to whoever helped them. Rewards are pass points, never ТрансКоин.
 */
import { and, count, eq, gt, gte, sql } from 'drizzle-orm';
import { CHAT_LIFE, questionFor } from '@/lib/game/chat-life';
import { featureLive } from '@/lib/game/features';
import { sofiaHour } from '@/lib/game/halloween';
import { sofiaDay } from '@/lib/game/shop-v2';
import type { Channel } from '@/lib/game/social';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { chatMessages, jobState, users } from '@/server/db/schema';
import { fail } from './errors';
import { notify } from './notify';
import { addPassPoints } from './season-pass';
import { t } from '@/i18n/t';

export type ChatLineKind = 'moment' | 'question' | 'partner' | 'project' | 'escort' | 'rumor' | 'cafe';

const ping = (tx: DbOrTx, channel: string) => tx.execute(sql`select pg_notify('tv_events', ${JSON.stringify({ type: 'channel', channel })})`);

/** The game's own author in the chat (made once; it cannot sign in). */
export async function botUserId(db: DbOrTx): Promise<string> {
  const [found] = await db.select({ id: users.id }).from(users).where(eq(users.email, CHAT_LIFE.botEmail));
  if (found) return found.id;
  // The name may already belong to a player: then a variant.
  for (const name of [CHAT_LIFE.botName, `${CHAT_LIFE.botName}_bot`, `${CHAT_LIFE.botName}_game`]) {
    const [row] = await db.insert(users).values({ email: CHAT_LIFE.botEmail, username: name, passwordHash: '!', termsAcceptedAt: new Date() }).onConflictDoNothing().returning({ id: users.id });
    if (row) return row.id;
    const [again] = await db.select({ id: users.id }).from(users).where(eq(users.email, CHAT_LIFE.botEmail));
    if (again) return again.id;
  }
  fail('bot_user', t('Системният автор на чата не може да бъде създаден.'), 500);
  return '';
}

/** A line from the game in a world channel, with an optional button. */
export async function postGameLine(tx: Tx, channel: Channel, kind: ChatLineKind, body: string, meta: { href?: string; button?: string } = {}, now = new Date()) {
  const author = await botUserId(tx);
  const [row] = await tx.insert(chatMessages).values({ channel, userId: author, body: body.slice(0, 500), kind, meta, createdAt: now }).returning({ id: chatMessages.id });
  await ping(tx, channel);
  return row!.id;
}

/**
 * A moment of the game in the global chat (a record, a legendary find, cleared roads…) —
 * once per key and at most one every few minutes, so the chat stays a chat.
 */
export async function postMoment(tx: Tx, key: string, body: string, meta: { href?: string; button?: string } = {}, now = new Date()) {
  if (!featureLive('chat_life', now)) return false;
  const [last] = await tx.select({ updatedAt: jobState.updatedAt }).from(jobState).where(eq(jobState.key, 'chat-moment:last'));
  if (last && now.getTime() - last.updatedAt.getTime() < CHAT_LIFE.momentGapMinutes * 60_000) return false;
  const [first] = await tx.insert(jobState).values({ key: `chat-moment:${key}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning();
  if (!first) return false;
  await tx.insert(jobState).values({ key: 'chat-moment:last', value: {}, updatedAt: now }).onConflictDoUpdate({ target: jobState.key, set: { updatedAt: now } });
  await postGameLine(tx, 'global', 'moment', body, meta, now);
  return true;
}

/** Worker: the question of the day in the global chat, once a day from the set hour (Sofia). */
export async function postDailyQuestion(db: Database, now = new Date()) {
  if (!featureLive('chat_life', now) || sofiaHour(now) < CHAT_LIFE.questionHour) return null;
  const day = sofiaDay(now);
  return db.transaction(async (tx) => {
    const [first] = await tx.insert(jobState).values({ key: `chat-question:${day}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning();
    if (!first) return null;
    const id = await postGameLine(tx, 'global', 'question', t('❓ Въпрос на деня: {0} Отговори с „Отговори“ — първите {1} получават {2} точки за пропуска.', questionFor(day), CHAT_LIFE.questionRewarded, CHAT_LIFE.questionPoints), {}, now);
    await tx.update(jobState).set({ value: { at: now.toISOString(), messageId: id } }).where(eq(jobState.key, `chat-question:${day}`));
    return id;
  });
}

/**
 * A player answered a line from the game. An answer to the question of the day, in time and among
 * the first ones (one per player), brings pass points.
 */
export async function rewardQuestionAnswer(tx: Tx, userId: string, replyToId: number, now: Date) {
  const [q] = await tx.select({ kind: chatMessages.kind, createdAt: chatMessages.createdAt }).from(chatMessages).where(eq(chatMessages.id, replyToId));
  if (q?.kind !== 'question' || now.getTime() - q.createdAt.getTime() > CHAT_LIFE.questionHours * 3_600_000) return false;
  const [mine] = await tx.insert(jobState).values({ key: `chat-answer:${replyToId}:${userId}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning();
  if (!mine) return false;
  const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(jobState).where(sql`${jobState.key} like ${`chat-answer:${replyToId}:%`}`);
  if (n > CHAT_LIFE.questionRewarded) return false;
  await addPassPoints(tx, userId, CHAT_LIFE.questionPoints, now);
  await notify(tx, userId, 'achievement', () => t('Въпрос на деня'), () => t('+{0} точки за пропуска за отговора.', CHAT_LIFE.questionPoints), '/game/seasons');
  return true;
}

/** May this viewer thank the author of a message? A new player, for an answer to their own message. */
export async function canThank(db: DbOrTx, viewer: { id: string; level: number }, messageId: number) {
  if (viewer.level > CHAT_LIFE.newbieLevel) return false;
  const [m] = await db.select({ userId: chatMessages.userId, replyToId: chatMessages.replyToId, kind: chatMessages.kind }).from(chatMessages).where(eq(chatMessages.id, messageId));
  if (!m || m.kind || !m.replyToId || m.userId === viewer.id) return false;
  const [orig] = await db.select({ userId: chatMessages.userId }).from(chatMessages).where(eq(chatMessages.id, m.replyToId));
  return orig?.userId === viewer.id;
}

/** A new player thanks whoever answered them: pass points for the helper (a few a day). */
export async function thankHelper(db: Database, who: { id: string; username: string }, messageId: number, now = new Date()) {
  if (!featureLive('chat_life', now)) fail('not_released', t('Това идва със следващото обновление.'), 403);
  const [me] = await db.select({ level: users.level }).from(users).where(eq(users.id, who.id));
  const viewer = { ...who, level: me?.level ?? 99 };
  if (!(await canThank(db, viewer, messageId))) fail('cannot_thank', t('Можеш да благодариш само за отговор на твое съобщение, докато си до ниво {0}.', CHAT_LIFE.newbieLevel));
  return db.transaction(async (tx) => {
    const [m] = await tx.select({ userId: chatMessages.userId }).from(chatMessages).where(eq(chatMessages.id, messageId));
    const [fresh] = await tx.insert(jobState).values({ key: `chat-thanks:${messageId}`, value: { by: viewer.id } }).onConflictDoNothing().returning();
    if (!fresh) fail('already_thanked', t('Вече благодари за този отговор.'));
    const day = sofiaDay(now);
    const [counter] = await tx.insert(jobState).values({ key: `chat-thanked:${m!.userId}:${day}`, value: { n: 1 } }).onConflictDoUpdate({ target: jobState.key, set: { value: sql`jsonb_build_object('n', coalesce((${jobState.value}->>'n')::int, 0) + 1)`, updatedAt: now } }).returning({ value: jobState.value });
    const n = Number((counter!.value as { n: number }).n);
    const points = n <= CHAT_LIFE.thanksPerDay ? CHAT_LIFE.thankPoints : 0;
    if (points) await addPassPoints(tx, m!.userId, points, now);
    await notify(tx, m!.userId, 'achievement', () => t('🙏 {0} ти благодари', viewer.username), () => (points ? t('За помощта в чата: +{0} точки за пропуска.', points) : t('За помощта в чата.')), '/game?chat=global');
    return { points };
  });
}

/** How many world-chat lines the game posted since a moment (for the admin and tests). */
export async function gameLinesSince(db: DbOrTx, since: Date) {
  const [row] = await db.select({ n: count() }).from(chatMessages).where(and(gte(chatMessages.createdAt, since), gt(sql`length(coalesce(${chatMessages.kind}, ''))`, 0)));
  return row?.n ?? 0;
}
