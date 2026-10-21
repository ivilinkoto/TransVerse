import { and, count, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { adminAudit, discordSanctions, discordTickets, supportMessages, supportTickets, users } from '@/server/db/schema';
import { discord } from './api';
import { answer, field, hasPerm, PERM, stop, type Answer, type Ctx } from './context';
import { BRAND, discordConfig } from './config';
import { enqueue } from './outbox';
import { button, modal, reply, rows, say, STYLE, textInput, update } from './ui';

/**
 * Appeals ("Обжалвай" in the message about a timeout or a ban): a short form,
 * then the team sees it in #банове or #предупреждения with "Приеми" and
 * "Откажи". Accepted: the ban or the timeout (and the game chat mute) is
 * lifted. The member gets the answer as a direct message. One appeal each.
 * Also /екип-статистика for the team.
 */

const LABEL: Record<string, string> = { timeout: 'заглушаване', ban: 'бан', warn: 'предупреждение' };

export async function appealForm(ctx: Ctx, id: number): Promise<Answer> {
  const [s] = await ctx.db.select().from(discordSanctions).where(eq(discordSanctions.id, id));
  if (!s || s.discordUserId !== ctx.discordId) stop('Това наказание не е твое.');
  if (s!.appealedAt) stop('Вече си обжалвал — екипът ще ти отговори.');
  return answer(modal(`appeal:send:${id}`, `Обжалване: ${LABEL[s!.kind] ?? s!.kind}`, [textInput('text', 'Защо да го премахнем?', { long: true, min: 20, max: 1000, placeholder: 'Опиши спокойно какво стана.' })]));
}

export async function appealSend(ctx: Ctx, id: number): Promise<Answer> {
  const text = field(ctx.i, 'text').trim().slice(0, 1000);
  if (text.length < 20) stop('Напиши поне няколко изречения.');
  const [s] = await ctx.db.update(discordSanctions).set({ appealText: text, appealedAt: ctx.now, appealStatus: 'pending' }).where(and(eq(discordSanctions.id, id), eq(discordSanctions.discordUserId, ctx.discordId), sql`${discordSanctions.appealedAt} is null`)).returning();
  if (!s) stop('Вече си обжалвал или наказанието не е твое.');
  await enqueue(ctx.db, `appeal:${id}`, `channel:${s!.kind === 'ban' ? 'bans' : 'warnings'}`, {
    ping: false,
    embeds: [{ title: `📝 Обжалване: ${LABEL[s!.kind] ?? s!.kind}`, color: 0x2f7bff, description: text, fields: [{ name: 'Член', value: `<@${s!.discordUserId}>`, inline: true }, { name: 'Причина за наказанието', value: s!.reason.slice(0, 500), inline: true }] }],
    components: rows(button('Приеми', `appeal:yes:${id}`, STYLE.success, '✅'), button('Откажи', `appeal:no:${id}`, STYLE.danger, '✖️')),
  }, ctx.now);
  return answer(say('📝 Изпратено. Екипът ще прегледа обжалването и ще ти пише тук.'));
}

/** The team decides. */
export async function appealDecide(ctx: Ctx, id: number, accept: boolean): Promise<Answer> {
  const [s0] = await ctx.db.select().from(discordSanctions).where(eq(discordSanctions.id, id));
  if (!s0) stop('Няма такова обжалване.');
  if (!hasPerm(ctx, s0!.kind === 'ban' ? PERM.ban : PERM.moderate)) stop('Нямаш право да решаваш това.');
  const [s] = await ctx.db.update(discordSanctions).set({ appealStatus: accept ? 'accepted' : 'rejected' }).where(and(eq(discordSanctions.id, id), eq(discordSanctions.appealStatus, 'pending'))).returning();
  if (!s) stop('Вече е решено.');
  const { guildId } = discordConfig();
  if (accept) {
    if (s!.kind === 'ban') await discord('DELETE', `/guilds/${guildId}/bans/${s!.discordUserId}`).catch(() => undefined);
    if (s!.kind === 'timeout') {
      await discord('PATCH', `/guilds/${guildId}/members/${s!.discordUserId}`, { communication_disabled_until: null }).catch(() => undefined);
      if (s!.inGame && s!.userId) await ctx.db.update(users).set({ chatMutedUntil: null }).where(eq(users.id, s!.userId));
    }
  }
  if (ctx.me) await ctx.db.insert(adminAudit).values({ actorId: ctx.me.id, action: accept ? 'discord_appeal_accepted' : 'discord_appeal_rejected', targetUserId: s!.userId, details: { sanctionId: id, kind: s!.kind } });
  await enqueue(ctx.db, `appeal-answer:${id}`, `dm:${s!.discordUserId}`, {
    embeds: [{ color: accept ? 0x2fd27a : 0xe04545, title: accept ? '✅ Обжалването е прието' : '✖️ Обжалването е отказано', description: accept ? (s!.kind === 'ban' ? 'Банът е свален — можеш да се върнеш в сървъра.' : 'Наказанието е премахнато.') : 'Екипът прегледа случая и наказанието остава.' }],
  }, ctx.now);
  return answer(update({ components: [], content: `${accept ? '✅ Прието' : '✖️ Отказано'} от <@${ctx.discordId}>` }));
}

/** /екип-статистика: tickets, answers and sanctions of the last 30 days. */
export async function staffStats(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.moderate)) stop('Само за екипа.');
  const since = new Date(ctx.now.getTime() - 30 * 86_400_000);
  const [{ opened = 0 } = {}] = await ctx.db.select({ opened: count() }).from(supportTickets).where(gte(supportTickets.createdAt, since));
  const [{ closed = 0 } = {}] = await ctx.db.select({ closed: count() }).from(supportTickets).where(and(gte(supportTickets.updatedAt, since), eq(supportTickets.status, 'closed')));
  const [{ fromDiscord = 0 } = {}] = await ctx.db.select({ fromDiscord: count() }).from(discordTickets).where(gte(discordTickets.createdAt, since));
  const { rows: first } = await ctx.db.execute<{ avg: number | null }>(sql`
    select avg(extract(epoch from (r.first - t.created_at)) / 60)::float as avg from support_tickets t
    join lateral (select min(m.created_at) as first from support_messages m where m.ticket_id = t.id and m.staff) r on r.first is not null
    where t.created_at >= ${since}`);
  const helpers = await ctx.db
    .select({ username: users.username, n: count() })
    .from(supportMessages)
    .innerJoin(users, eq(users.id, supportMessages.authorId))
    .where(and(eq(supportMessages.staff, true), gte(supportMessages.createdAt, since)))
    .groupBy(users.username)
    .orderBy(sql`2 desc`)
    .limit(8);
  const mods = await ctx.db
    .select({ id: discordSanctions.moderatorDiscordId, n: count() })
    .from(discordSanctions)
    .where(and(gte(discordSanctions.createdAt, since), isNotNull(discordSanctions.moderatorDiscordId)))
    .groupBy(discordSanctions.moderatorDiscordId)
    .orderBy(sql`2 desc`)
    .limit(8);
  const avg = first[0]?.avg;
  return answer(reply({
    embeds: [{
      title: '📊 Екипът · последните 30 дни',
      color: BRAND,
      fields: [
        { name: 'Тикети', value: `${opened} нови · ${closed} затворени · ${fromDiscord} от Discord`, inline: false },
        { name: 'Първи отговор', value: avg == null ? '—' : avg < 60 ? `средно ${Math.round(avg)} мин` : `средно ${(avg / 60).toFixed(1)} ч`, inline: true },
        { name: 'Отговори', value: helpers.map((h) => `**${h.username}** · ${h.n}`).join('\n') || '—', inline: true },
        { name: 'Наказания', value: mods.map((m) => `${m.id === 'automod' ? '🛡️ Автомодерация' : `<@${m.id}>`} · ${m.n}`).join('\n') || '—', inline: true },
      ],
    }],
  }, true));
}
