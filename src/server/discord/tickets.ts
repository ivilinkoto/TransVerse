import { and, asc, count, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { discordTickets, jobState, supportMessages, supportTickets, users } from '@/server/db/schema';
import { replyToTicket, TICKET_CATEGORIES } from '@/server/game/support';
import { discord, DiscordError } from './api';
import { act, answer, editOriginal, field, hasPerm, PERM, stop, type Answer, type Ctx } from './context';
import { appUrl, BRAND, discordConfig, DISCORD_ROLES, TICKET_CATEGORY } from './config';
import { ensureRole, forgetGuild } from './guild';
import { layoutCategory, layoutState, saveLayoutState } from './layout';
import { enqueue } from './outbox';
import { button, deferred, modal, reply, rows, say, select, STYLE, textInput } from './ui';
import { t as tr } from '@/i18n/t';

/**
 * Tickets in Discord (#тикети → "Отвори тикет"): a private channel for the
 * player and the team. With a linked account it is a ticket in the game too
 * and the messages go both ways; without one (e.g. the player cannot log in)
 * it lives only in Discord.
 */

const MAX_OPEN = 3;
const KEEP_CLOSED_MS = 24 * 3_600_000;
const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const EMBED = 1n << 14n;
const ATTACH = 1n << 15n;
const HISTORY = 1n << 16n;
const bits = (...b: bigint[]) => b.reduce((a, x) => a | x, 0n).toString();

/** "Отвори тикет": first the kind of problem. */
export async function openTicket(ctx: Ctx): Promise<Answer> {
  const [{ n = 0 } = {}] = await ctx.db.select({ n: count() }).from(discordTickets).where(and(eq(discordTickets.discordUserId, ctx.discordId), isNull(discordTickets.closedAt)));
  if (n >= MAX_OPEN) stop(tr('Имаш {0} отворени тикета — изчакай отговор или затвори някой.', n));
  return answer(reply({
    content: tr('За какво е тикетът?'),
    components: rows(select('ticket:cat', Object.entries(TICKET_CATEGORIES).map(([value, label]) => ({ label, value })), tr('Избери тема'))),
  }, true));
}

/** Then the subject and the description. */
export function ticketForm(ctx: Ctx, category: string): Answer {
  if (!(category in TICKET_CATEGORIES)) stop(tr('Няма такава тема.'));
  return answer(modal(`ticket:new:${category}`, tr('Нов тикет'), [
    textInput('subject', tr('Тема'), { min: 4, max: 120, placeholder: tr('Накратко: какво се случи?') }),
    textInput('body', tr('Описание'), { long: true, min: 10, max: 4000, placeholder: tr('Опиши проблема — какво направи, какво очакваше, какво стана.') }),
  ]));
}

const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || tr('тикет');

async function ticketCategory(ctx: Ctx, staffRole: string, botId: string) {
  const found = await layoutCategory(ctx.db, tr('отворени-тикети'), TICKET_CATEGORY);
  if (found) return found;
  const { guildId } = discordConfig();
  const cat = await discord<{ id: string }>('POST', `/guilds/${guildId}/channels`, {
    name: tr('🎫 ┃ ОТВОРЕНИ ТИКЕТИ'),
    type: 4,
    permission_overwrites: [{ id: guildId, type: 0, allow: '0', deny: bits(VIEW) }, { id: staffRole, type: 0, allow: bits(VIEW, SEND, HISTORY), deny: '0' }, { id: botId, type: 1, allow: bits(VIEW, SEND, HISTORY, EMBED), deny: '0' }],
  });
  const state = await layoutState(ctx.db);
  state.categories['отворени-тикети'] = cat.id;
  await saveLayoutState(ctx.db, state);
  forgetGuild();
  return cat.id;
}

/** The form is sent: the ticket (in the game too, when linked) and its private channel. */
export async function createTicketFromForm(ctx: Ctx, category: string): Promise<Answer> {
  if (!(category in TICKET_CATEGORIES)) stop(tr('Няма такава тема.'));
  const subject = field(ctx.i, 'subject').trim().slice(0, 120);
  const body = field(ctx.i, 'body').trim().slice(0, 4000);
  if (subject.length < 4 || body.length < 10) stop(tr('Темата и описанието са твърде кратки.'));
  const ticketId = ctx.me ? (await act<{ id: string }>(ctx, { type: 'createTicket', ticket: { subject, category: category as keyof typeof TICKET_CATEGORIES, body } }, { gated: false })).id : null;
  return answer(deferred(), async () => {
    const { guildId } = discordConfig();
    const staffRole = await ensureRole(DISCORD_ROLES.staff.name, DISCORD_ROLES.staff.color);
    const me = await discord<{ id: string }>('GET', '/users/@me');
    const parent = await ticketCategory(ctx, staffRole, me.id);
    const channel = await discord<{ id: string }>('POST', `/guilds/${guildId}/channels`, {
      name: `🎫┃${slug(ctx.me?.username ?? ctx.discordName)}`,
      type: 0,
      parent_id: parent,
      topic: tr('Тикет: {0}', subject),
      permission_overwrites: [
        { id: guildId, type: 0, allow: '0', deny: bits(VIEW) },
        { id: ctx.discordId, type: 1, allow: bits(VIEW, SEND, HISTORY, ATTACH, EMBED), deny: '0' },
        { id: staffRole, type: 0, allow: bits(VIEW, SEND, HISTORY, ATTACH, EMBED), deny: '0' },
        { id: me.id, type: 1, allow: bits(VIEW, SEND, HISTORY, EMBED), deny: '0' },
      ],
    });
    await ctx.db.insert(discordTickets).values({ channelId: channel.id, discordUserId: ctx.discordId, ticketId, subject });
    await discord('POST', `/channels/${channel.id}/messages`, {
      content: `<@${ctx.discordId}> <@&${staffRole}>`,
      allowed_mentions: { parse: [], users: [ctx.discordId], roles: [staffRole] },
      embeds: [{
        title: `🎫 ${subject}`,
        color: BRAND,
        description: body,
        fields: [
          { name: tr('Тема'), value: TICKET_CATEGORIES[category as keyof typeof TICKET_CATEGORIES], inline: true },
          { name: tr('Играч'), value: ctx.me ? `[${ctx.me.username}](${appUrl()}/game/players/${encodeURIComponent(ctx.me.username)})` : tr('няма свързан акаунт'), inline: true },
        ],
        footer: { text: ticketId ? tr('Тикетът е и в играта (Поддръжка) — отговорите идват на двете места.') : tr('Само в Discord — свържи акаунта си, за да е и в играта.') },
      }],
      components: rows(button(tr('Затвори тикета'), 'ticket:close', STYLE.danger, '🔒')),
    });
    await editOriginal(ctx.i, { content: tr('✅ Тикетът е отворен: <#{0}>', channel.id) });
  });
}

/** Locks the channel for the player and schedules its removal. */
async function closeChannel(db: Database, t: typeof discordTickets.$inferSelect, by: string, now: Date) {
  await db.update(discordTickets).set({ closedAt: now }).where(and(eq(discordTickets.channelId, t.channelId), isNull(discordTickets.closedAt)));
  try {
    await discord('PUT', `/channels/${t.channelId}/permissions/${t.discordUserId}`, { type: 1, allow: bits(VIEW, HISTORY), deny: bits(SEND) });
    await discord('POST', `/channels/${t.channelId}/messages`, { embeds: [{ color: 0x9aa3b2, description: tr('🔒 Тикетът е затворен от {0}. Каналът ще бъде изтрит след 24 часа.', by) }], allowed_mentions: { parse: [] } });
  } catch (error) {
    if (!(error instanceof DiscordError && error.status === 404)) throw error;
  }
}

/** "Затвори тикета": the player or the team. */
export async function closeTicket(ctx: Ctx): Promise<Answer> {
  const [t] = await ctx.db.select().from(discordTickets).where(eq(discordTickets.channelId, ctx.i.channel_id ?? ''));
  if (!t) stop(tr('Това не е тикет.'));
  if (t!.closedAt) stop(tr('Тикетът вече е затворен.'));
  const staffRole = await ensureRole(DISCORD_ROLES.staff.name, DISCORD_ROLES.staff.color);
  const team = hasPerm(ctx, PERM.manageMessages) || !!ctx.i.member?.roles?.includes(staffRole);
  if (t!.discordUserId !== ctx.discordId && !team) stop(tr('Само авторът и екипът могат да затворят тикета.'));
  // The game ticket closes too (when the one who closes is linked: the player or the team).
  if (t!.ticketId && ctx.me) await act(ctx, { type: 'closeTicket', ticketId: t!.ticketId }, { gated: false });
  await closeChannel(ctx.db, t!, `<@${ctx.discordId}>`, ctx.now);
  return answer(say(tr('🔒 Затворен.')));
}

/** Discord → game: a message in a ticket channel becomes a reply in the game ticket (linked authors). */
export async function ticketMessageFromDiscord(db: Database, m: { id: string; channel_id: string; content: string; author: { id: string; bot?: boolean }; webhook_id?: string; attachments?: unknown[] }) {
  if (m.author.bot || m.webhook_id) return false;
  const [t] = await db.select().from(discordTickets).where(and(eq(discordTickets.channelId, m.channel_id), isNull(discordTickets.closedAt), isNotNull(discordTickets.ticketId)));
  if (!t) return false;
  const [u] = await db.select({ id: users.id, role: users.role, username: users.username }).from(users).where(and(eq(users.discordId, m.author.id), isNull(users.bannedAt)));
  if (!u) return false;
  const body = `${m.content ?? ''}${m.attachments?.length ? tr('{0}[прикачен файл в Discord]', m.content ? ' ' : '') : ''}`.trim().slice(0, 4000);
  if (!body) return false;
  await replyToTicket(db, u, t.ticketId!, body, m.id);
  return true;
}

/**
 * Worker: game → Discord. Replies written in the game go to the ticket's
 * channel; tickets closed in the game close their channel; a day after
 * closing the channel is removed.
 */
export async function syncTickets(db: Database, now = new Date()) {
  if (!discordConfig().bot) return;
  const [cur] = await db.select().from(jobState).where(eq(jobState.key, 'discord-ticket-cursor'));
  let from = Number((cur?.value as { id?: number } | undefined)?.id ?? -1);
  if (from < 0) from = Number((await db.execute<{ m: number }>(sql`select coalesce(max(id), 0)::bigint as m from support_messages`)).rows[0]?.m ?? 0);
  const rows = await db
    .select({ id: supportMessages.id, body: supportMessages.body, staff: supportMessages.staff, author: users.username, channelId: discordTickets.channelId })
    .from(supportMessages)
    .innerJoin(users, eq(users.id, supportMessages.authorId))
    .innerJoin(discordTickets, and(eq(discordTickets.ticketId, supportMessages.ticketId), isNull(discordTickets.closedAt)))
    .where(and(gt(supportMessages.id, from), isNull(supportMessages.discordMessageId)))
    .orderBy(asc(supportMessages.id))
    .limit(100);
  for (const r of rows) {
    await enqueue(db, `ticket-msg:${r.id}`, `msg:${r.channelId}`, { embeds: [{ color: r.staff ? BRAND : 0x2f7bff, author: { name: r.staff ? tr('Поддръжка · {0}', r.author) : r.author }, description: r.body.slice(0, 4000), footer: { text: tr('написано в играта') } }] }, now);
  }
  const top = rows.length ? rows.at(-1)!.id : Number((await db.execute<{ m: number }>(sql`select coalesce(max(id), 0)::bigint as m from support_messages`)).rows[0]?.m ?? from);
  await db.insert(jobState).values({ key: 'discord-ticket-cursor', value: { id: Math.max(from, top) } }).onConflictDoUpdate({ target: jobState.key, set: { value: { id: Math.max(from, top) }, updatedAt: now } });

  // Closed in the game.
  const closedInGame = await db
    .select({ t: discordTickets })
    .from(discordTickets)
    .innerJoin(supportTickets, eq(supportTickets.id, discordTickets.ticketId))
    .where(and(isNull(discordTickets.closedAt), eq(supportTickets.status, 'closed')));
  for (const { t } of closedInGame) await closeChannel(db, t, tr('играта'), now);

  // A day after closing the channel goes.
  const old = await db.select().from(discordTickets).where(and(lt(discordTickets.closedAt, new Date(now.getTime() - KEEP_CLOSED_MS)), isNull(discordTickets.deletedAt))).limit(20);
  for (const t of old) {
    await discord('DELETE', `/channels/${t.channelId}`).catch((e) => {
      if (!(e instanceof DiscordError && e.status === 404)) throw e;
    });
    await db.update(discordTickets).set({ deletedAt: now }).where(eq(discordTickets.channelId, t.channelId));
  }
}
