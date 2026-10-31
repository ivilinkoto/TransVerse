import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, like, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { discordOutbox, jobState, users, vehicles } from '@/server/db/schema';
import { featureLive } from '@/lib/game/features';
import { visibleReleases } from '@/lib/game/releases';
import { ONLINE_MS } from '@/lib/game/social';
import { IDEAS } from '@/server/game/ideas';
import { GameError } from '@/server/game/errors';
import { runAction } from '@/server/game/actions';
import { int } from '@/lib/format';
import { t, tx } from '@/i18n/t';
import { discord, DiscordError, noPings } from './api';
import { appUrl, BRAND, discordConfig } from './config';
import { ideasOn } from './announce';
import { answer, hasPerm, linkHint, opt, PERM, stop, act, type Answer, type Ctx } from './context';
import { layoutChannel } from './layout';
import { pinPosted, postIn, removePosted, threadParent, type Posted } from './guild';
import { announce } from './outbox';
import { upsertLiveCard } from './live-card';
import { button, rows, say, STYLE, update } from './ui';

/**
 * 1.1.3.2 „Discord“: the channels that had nothing behind them.
 * - #идеи: every new idea from the game (with a vote button); a message a
 *   linked player writes there becomes an idea in the game; status changes.
 * - #докладвай-бъг: a message becomes a support ticket (linked) or goes to
 *   the team's #сигнали (not linked); the bot answers under it.
 * - #статус: one pinned message the worker refreshes every few minutes, and a
 *   note after the game was not answering for a while.
 * - #новини and #анкети: /новина and /анкета for the team.
 */

interface ChannelMessage {
  id: string;
  channel_id: string;
  content: string;
  webhook_id?: string;
  author: { id: string; bot?: boolean; username?: string; global_name?: string | null };
  attachments?: { url: string }[];
}

const linkedUser = async (db: DbOrTx, discordId: string) => (await db.select().from(users).where(and(eq(users.discordId, discordId), isNull(users.bannedAt))))[0] ?? null;

/** An answer under a member's message. */
async function replyTo(m: ChannelMessage, content: string) {
  await discord('POST', `/channels/${m.channel_id}/messages`, { content, message_reference: { message_id: m.id, fail_if_not_exists: false }, allowed_mentions: { parse: [], replied_user: true } });
}

const asGame = (u: typeof users.$inferSelect) => ({ id: u.id, role: u.role, username: u.username });
const errorText = (e: unknown) => (e instanceof GameError ? e.message : null);

/**
 * Whether a message counts for one of these channels: written in it (a text
 * channel), or opening a post in it when the channel is a forum — then the
 * post's title comes along. Replies inside a post are just conversation.
 */
async function placeOf(db: Database, m: ChannelMessage, key: string): Promise<{ forum: boolean; title: string | null } | null> {
  const target = await layoutChannel(db, key);
  if (!target) return null;
  if (m.channel_id === target) return { forum: false, title: null };
  // A forum post's first message has the id of the post itself.
  if (m.id !== m.channel_id || (await threadParent(m.channel_id)) !== target) return null;
  const post = await discord<{ name?: string }>('GET', `/channels/${m.channel_id}`).catch(() => null);
  return { forum: true, title: post?.name?.trim() || null };
}

// ── #идеи ────────────────────────────────────────────────────────────────

/** "Гласувай" under an idea. */
export async function ideaVote(ctx: Ctx, ideaId: string): Promise<Answer> {
  const r = await act<{ voted: boolean; votes: number }>(ctx, { type: 'voteIdea', ideaId });
  return answer(say(r.voted ? t('👍 Гласът ти е записан — идеята има {0} гласа.', r.votes) : t('Махнах гласа ти — идеята има {0} гласа.', r.votes)));
}

/** The gateway: a message in #идеи from a linked player becomes an idea in the game. */
export async function ideaFromDiscord(db: Database, m: ChannelMessage, now = new Date()) {
  if (m.author.bot || m.webhook_id || !ideasOn(now)) return false;
  const place = await placeOf(db, m, 'идеи');
  if (!place) return false;
  const text = (m.content ?? '').trim();
  if (!text && !place.title) return false;
  const me = await linkedUser(db, m.author.id);
  if (!me) {
    await replyTo(m, t('За да стане идея в играта, свържи акаунта си. {0}', linkHint()));
    return true;
  }
  // In a forum the post's title is the idea's title and the message its description.
  const [first, ...rest] = text.split('\n');
  const title = (place.title ?? first!).trim().slice(0, IDEAS.titleMax);
  const body = (place.title ? text : rest.join('\n')).trim().slice(0, IDEAS.bodyMax);
  if (title.length < 5) {
    await replyTo(m, t('Първият ред е заглавието на идеята — поне 5 знака. Описанието пиши на следващите редове.'));
    return true;
  }
  let ideaId: string;
  try {
    ideaId = ((await runAction(db, asGame(me), { type: 'submitIdea', idea: { title, body } }, async () => `discord:${m.author.id}`)) as { id: string }).id;
  } catch (e) {
    const why = errorText(e);
    if (!why) throw e;
    await replyTo(m, `⚠️ ${why}`);
    return true;
  }
  if (place.forum) {
    // A forum post stays (deleting its first message would empty it): the vote button goes
    // under it, instead of a second post with the same idea.
    await db.delete(discordOutbox).where(and(like(discordOutbox.dedupeKey, `idea:${ideaId}%`), isNull(discordOutbox.sentAt)));
    await discord('POST', `/channels/${m.channel_id}/messages`, { ...noPings, content: t('✅ Идеята е записана в играта — гласувайте с бутона.'), components: rows(button(t('Гласувай'), `idea:vote:${ideaId}`, STYLE.success, '👍')) });
    return true;
  }
  // The idea comes back as the bot's card with the vote button; the member's message goes.
  await discord('DELETE', `/channels/${m.channel_id}/messages/${m.id}`).catch(() => replyTo(m, t('✅ Идеята е записана в играта.')));
  return true;
}

// ── #докладвай-бъг ───────────────────────────────────────────────────────

/** The gateway: a message in #докладвай-бъг becomes a ticket (linked) or goes to the team (not linked). */
export async function bugFromDiscord(db: Database, m: ChannelMessage, now = new Date()) {
  if (m.author.bot || m.webhook_id || !featureLive('discord_bot', now) || !featureLive('discord_bug_reports', now)) return false;
  const place = await placeOf(db, m, 'докладвай-бъг');
  if (!place) return false;
  const text = (m.content ?? '').trim();
  const files = (m.attachments ?? []).map((a) => a.url);
  if (text.length < 10 && !files.length) {
    await replyTo(m, t('Опиши малко повече (поне 10 знака): какво направи, какво очакваше и какво стана.'));
    return true;
  }
  const body = `${text}${files.length ? `\n\n${files.join('\n')}` : ''}`.slice(0, 4000).padEnd(10, '.');
  // In a forum the post's title is the subject.
  const subject = (place.title ?? text.split('\n')[0] ?? '').trim().slice(0, 120);
  const me = await linkedUser(db, m.author.id);
  if (me) {
    try {
      const created = (await runAction(db, asGame(me), { type: 'createTicket', ticket: { subject: subject.length >= 4 ? subject : t('Бъг от Discord'), category: 'bug', body } }, async () => `discord:${m.author.id}`)) as { id: string };
      // 1.1.3.4: ✅ from the team under this message closes the ticket (plus.ts).
      await db.insert(jobState).values({ key: `bug-ticket:${m.id}`, value: { ticketId: created.id, channelId: m.channel_id } }).onConflictDoNothing();
    } catch (e) {
      const why = errorText(e);
      if (!why) throw e;
      await replyTo(m, `⚠️ ${why}`);
      return true;
    }
    await discord('PUT', `/channels/${m.channel_id}/messages/${m.id}/reactions/${encodeURIComponent('🐞')}/@me`).catch(() => undefined);
    await replyTo(m, t('✅ Благодарим! Записахме го като запитване в играта (Поддръжка) — отговорът ще дойде там и като известие.'));
    return true;
  }
  await announce(db, `bug:${m.id}`, 'staffAlerts', {
    ping: false,
    embeds: [{ title: t('🐞 Бъг от Discord (без свързан акаунт)'), description: body.slice(0, 3500), color: 0xe04545, fields: [{ name: t('От'), value: `<@${m.author.id}>`, inline: true }, { name: t('Съобщение'), value: `https://discord.com/channels/${discordConfig().guildId}/${m.channel_id}/${m.id}`, inline: true }] }],
  }, now);
  await replyTo(m, t('✅ Благодарим! Предадохме го на екипа. Свържи акаунта си, за да получиш отговор в играта: {0}/game/settings#discord', appUrl()));
  return true;
}

// ── #статус ──────────────────────────────────────────────────────────────

const STATUS_KEY = 'discord-status';
/** A gap longer than this between two refreshes means the game was not answering. */
export const STATUS_GAP_MS = 12 * 60_000;
type StatusState = Posted & { at: number };

/** The live status card (also used by the tests); the last outage, when there was one in the last day. */
export async function statusMessage(db: DbOrTx, now: Date, outage?: { from: number; to: number } | null) {
  const [[{ online = 0 } = {}], [{ road = 0 } = {}]] = await Promise.all([
    db.select({ online: sql<number>`count(*)::int` }).from(users).where(gt(users.lastSeenAt, new Date(now.getTime() - ONLINE_MS))),
    db.select({ road: sql<number>`count(*)::int` }).from(vehicles).where(eq(vehicles.status, 'on_delivery')),
  ]);
  const release = visibleReleases(now)[0];
  const recent = outage && now.getTime() - outage.to < 24 * 3_600_000 ? outage : null;
  return {
    ...noPings,
    embeds: [{
      title: t('🟢 TransVerse работи'),
      description: t('Картата се обновява на всеки 5 минути. Ако часът долу спре да се мени, играта не отговаря.'),
      color: 0x2fd27a,
      fields: [
        { name: t('Версия'), value: release ? `${release.version} „${tx(release.name)}“` : '—', inline: true },
        { name: t('В играта сега'), value: int(online), inline: true },
        { name: t('На пътя'), value: t('{0} камиона', int(road)), inline: true },
        ...(recent ? [{ name: t('Последно прекъсване'), value: t('<t:{0}:t> – <t:{1}:t> (около {2} мин) · вече работи', Math.floor(recent.from / 1000), Math.floor(recent.to / 1000), Math.round((recent.to - recent.from) / 60_000)), inline: false }] : []),
        { name: t('Последна проверка'), value: `<t:${Math.floor(now.getTime() / 1000)}:R>`, inline: false },
      ],
      url: appUrl(),
      timestamp: now.toISOString(),
    }],
  };
}

/**
 * Worker: edits the one pinned status card (1.1.4.2: never posts a copy; a
 * pause no longer posts a separate message — the card shows the last outage).
 */
export async function updateStatus(db: Database, now = new Date()): Promise<'posted' | 'updated' | 'off'> {
  if (!discordConfig().bot || !featureLive('discord_bot', now) || !featureLive('discord_status', now)) return 'off';
  const [row] = await db.select().from(jobState).where(eq(jobState.key, STATUS_KEY));
  const state = (row?.value ?? null) as (StatusState & { outage?: { from: number; to: number } | null }) | null;
  const outage = state && now.getTime() - state.at > STATUS_GAP_MS ? { from: state.at, to: now.getTime() } : (state?.outage ?? null);
  const message = await statusMessage(db, now, outage);
  try {
    return await upsertLiveCard(db, STATUS_KEY, 'статус', message, now, { at: now.getTime(), outage });
  } catch (e) {
    throw new Error(`#статус: ${(e as Error).message}`);
  }
}

// ── #новини ──────────────────────────────────────────────────────────────

/** /новина (the team): a post in #новини, also on the English and Russian side when written there. */
export async function newsCommand(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.manageGuild)) stop(t('Само екипът публикува новини.'));
  const title = (opt(ctx.i, 'заглавие') ?? '').trim().slice(0, 200);
  const text = (opt(ctx.i, 'текст') ?? '').replace(/\\n/g, '\n').trim().slice(0, 3800);
  if (title.length < 3 || text.length < 5) stop(t('Заглавието и текстът са твърде кратки.'));
  await announce(ctx.db, `news:${ctx.i.id ?? randomUUID()}`, 'teamNews', { embeds: [{ title: `📣 ${title}`, description: text, color: 0x22d3ee, footer: { text: t('Екипът на TransVerse · {0}', ctx.discordName) }, timestamp: ctx.now.toISOString() }] }, ctx.now);
  return answer(say(t('✅ Новината е на опашката за #новини (до минута).')));
}

// ── #анкети ──────────────────────────────────────────────────────────────

const POLL_PREFIX = 'team-poll:';
interface TeamPoll { question: string; options: string[]; votes: Record<string, number>; endsAt: number; channelId: string; messageId: string | null; closed?: boolean }

function pollView(id: string, p: TeamPoll, now: Date) {
  const counts = p.options.map((_, i) => Object.values(p.votes).filter((v) => v === i).length);
  const total = counts.reduce((a, b) => a + b, 0);
  const open = !p.closed && now.getTime() < p.endsAt;
  const lines = p.options.map((o, i) => {
    const share = total ? counts[i]! / total : 0;
    return `**${o}**\n${'█'.repeat(Math.round(share * 12)).padEnd(12, '░')} ${Math.round(share * 100)}% · ${counts[i]}`;
  });
  return {
    ...noPings,
    embeds: [{
      title: `📊 ${p.question}`,
      description: `${lines.join('\n\n')}\n\n${open ? t('Гласувай с бутоните (може да смениш гласа). Край <t:{0}:R>.', Math.floor(p.endsAt / 1000)) : t('Анкетата приключи · {0} гласа.', total)}`,
      color: open ? BRAND : 0x9aa3b2,
    }],
    components: open ? rows(...p.options.map((o, i) => button(o.slice(0, 80), `tpoll:${id}:${i}`, STYLE.secondary))) : [],
  };
}

/** /анкета (the team): question, 2–5 answers separated by ";", how many hours. */
export async function pollCommand(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.manageGuild)) stop(t('Само екипът пуска анкети.'));
  const question = (opt(ctx.i, 'въпрос') ?? '').trim().slice(0, 200);
  const options = (opt(ctx.i, 'отговори') ?? '').split(';').map((s) => s.trim().slice(0, 80)).filter(Boolean);
  const hours = Math.round(Number(opt(ctx.i, 'часове') ?? 24));
  if (question.length < 5) stop(t('Въпросът е твърде кратък.'));
  if (options.length < 2 || options.length > 5) stop(t('Отговорите са от 2 до 5, разделени с „;“.'));
  if (!(hours >= 1 && hours <= 168)) stop(t('Анкетата трае от 1 до 168 часа.'));
  const channelId = await layoutChannel(ctx.db, 'анкети');
  if (!channelId) stop(t('Няма канал #анкети — подреди сървъра от админ панела.'));
  const id = randomUUID().slice(0, 8);
  const poll: TeamPoll = { question, options, votes: {}, endsAt: ctx.now.getTime() + hours * 3_600_000, channelId: channelId!, messageId: null };
  // In a forum channel the poll is a post of its own.
  const posted = await postIn(channelId!, pollView(id, poll, ctx.now));
  await ctx.db.insert(jobState).values({ key: POLL_PREFIX + id, value: { ...poll, channelId: posted.channelId, messageId: posted.messageId } });
  return answer(say(t('✅ Анкетата е в <#{0}>.', channelId!)));
}

/** A vote (or a changed vote) — the poll's own message shows the new numbers. */
export async function pollVote(ctx: Ctx, id: string, index: number): Promise<Answer> {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(jobState).where(eq(jobState.key, POLL_PREFIX + id)).for('update');
    const poll = row?.value as TeamPoll | undefined;
    if (!poll || poll.closed || ctx.now.getTime() >= poll.endsAt) return answer(say(t('Анкетата вече е приключила.')));
    if (!Number.isInteger(index) || index < 0 || index >= poll.options.length) return answer(say(t('Този бутон вече не работи.')));
    const votes = { ...poll.votes, [ctx.discordId]: index };
    const next = { ...poll, votes };
    await tx.update(jobState).set({ value: next, updatedAt: ctx.now }).where(eq(jobState.key, POLL_PREFIX + id));
    return answer(update(pollView(id, next, ctx.now)));
  });
}

/** Worker: polls that ended show their results and lose the buttons. */
export async function closeTeamPolls(db: Database, now = new Date()) {
  if (!discordConfig().bot) return 0;
  const rows = await db.select().from(jobState).where(sql`${jobState.key} like ${POLL_PREFIX + '%'}`);
  let closed = 0;
  for (const r of rows) {
    const poll = r.value as TeamPoll;
    if (poll.closed || now.getTime() < poll.endsAt) continue;
    const id = r.key.slice(POLL_PREFIX.length);
    const done = { ...poll, closed: true };
    if (poll.messageId) await discord('PATCH', `/channels/${poll.channelId}/messages/${poll.messageId}`, pollView(id, done, now)).catch(() => undefined);
    await db.update(jobState).set({ value: done, updatedAt: now }).where(eq(jobState.key, r.key));
    closed++;
  }
  // Ended polls are kept 30 days.
  await db.delete(jobState).where(sql`${jobState.key} like ${POLL_PREFIX + '%'} and ${jobState.updatedAt} < ${new Date(now.getTime() - 30 * 86_400_000)}`);
  return closed;
}
