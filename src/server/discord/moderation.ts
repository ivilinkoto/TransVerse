import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { isStaff } from '@/server/auth/roles';
import { adminAudit, discordSanctions, users } from '@/server/db/schema';
import { notify } from '@/server/game/notify';
import { discord, DiscordError } from './api';
import { answer, hasPerm, opt, PERM, stop, type Answer, type Ctx } from './context';
import { discordConfig } from './config';
import { enqueue } from './outbox';
import { button, reply, rows, STYLE } from './ui';
import { t as tr, tx, intlLocale } from '@/i18n/t';

/**
 * Moderation in the server: /предупреждение, /заглуши, /бан, /разбани and
 * /наказания. Only members with the Discord rights (Moderate / Ban Members)
 * see and use them. Every step is kept (discord_sanctions), written to
 * #предупреждения or #банове and sent to the member as a direct message.
 * /заглуши can mute the chat in the game too — only when the moderator is
 * on the game's team and the member is linked.
 */

const MAX_TIMEOUT_MIN = 28 * 24 * 60;
const when = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:f>`;

function target(ctx: Ctx) {
  const id = opt(ctx.i, tr('потребител'));
  if (!id) stop(tr('Избери потребител.'));
  const u = ctx.i.data?.resolved?.users?.[id!];
  if (u?.bot) stop(tr('Ботовете не се наказват.'));
  if (id === ctx.discordId) stop(tr('Не можеш да наказваш себе си.'));
  return { id: id!, name: u?.global_name || u?.username || id! };
}

async function linkedUser(ctx: Ctx, discordId: string) {
  const [u] = await ctx.db.select({ id: users.id, username: users.username }).from(users).where(eq(users.discordId, discordId));
  return u ?? null;
}

/** The member's message; with "Обжалвай" for a timeout or a ban (appeals.ts). */
const dmMessage = (title: string, description: string, color: number, sanctionId?: number) => ({
  embeds: [{ title, description, color, footer: { text: tr('Сървърът на TransVerse · при въпрос — отвори тикет') } }],
  ...(sanctionId ? { components: rows(button(tr('Обжалвай'), `appeal:open:${sanctionId}`, STYLE.secondary, '📝')) } : {}),
});
const dm = (ctx: Ctx, discordId: string, title: string, description: string, color: number, sanctionId?: number) =>
  enqueue(ctx.db, `mod-dm:${discordId}:${ctx.now.getTime()}`, `dm:${discordId}`, dmMessage(title, description, color, sanctionId), ctx.now);
const log = (ctx: Ctx, channel: 'warnings' | 'bans', title: string, fields: { name: string; value: string; inline?: boolean }[], color: number) =>
  enqueue(ctx.db, `mod-log:${channel}:${ctx.now.getTime()}:${ctx.discordId}`, `channel:${channel}`, { ping: false, embeds: [{ title, color, fields, timestamp: ctx.now.toISOString() }] }, ctx.now);

async function record(ctx: Ctx, t: { id: string }, kind: string, reason: string, until: Date | null, inGame = false) {
  const u = await linkedUser(ctx, t.id);
  const [row] = await ctx.db.insert(discordSanctions).values({ discordUserId: t.id, userId: u?.id ?? null, kind, reason, until, inGame, moderatorDiscordId: ctx.discordId, moderatorUserId: ctx.me?.id ?? null, createdAt: ctx.now }).returning({ id: discordSanctions.id });
  // In the game's audit log when the moderator is linked.
  if (ctx.me) await ctx.db.insert(adminAudit).values({ actorId: ctx.me.id, action: `discord_${kind}`, targetUserId: u?.id ?? null, details: { discordUserId: t.id, reason, until: until?.toISOString() ?? null, inGame } });
  return { user: u, sanctionId: row!.id };
}

const discordFail = (e: unknown): never => {
  if (e instanceof DiscordError && (e.status === 403 || e.status === 404)) stop(tr('Discord не позволи — членът е с по-висока роля от бота или вече не е в сървъра.'));
  throw e;
};

export async function warn(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.moderate)) stop(tr('Нямаш право да предупреждаваш.'));
  const t = target(ctx);
  const reason = (opt(ctx.i, tr('причина')) ?? '').trim().slice(0, 500) || tr('Без причина');
  await record(ctx, t, 'warn', reason, null);
  const [{ n = 0 } = {}] = await ctx.db.select({ n: count() }).from(discordSanctions).where(and(eq(discordSanctions.discordUserId, t.id), eq(discordSanctions.kind, 'warn')));
  await dm(ctx, t.id, tr('⚠️ Предупреждение'), tr('Получаваш предупреждение в сървъра на TransVerse.\n**Причина:** {0}\n\nМоля, спазвай #правила — при повторно нарушение следва заглушаване или бан.', reason), 0xf6c343);
  await log(ctx, 'warnings', tr('⚠️ Предупреждение № {0}', n), [{ name: tr('Член'), value: `<@${t.id}> (${t.name})`, inline: true }, { name: tr('Модератор'), value: `<@${ctx.discordId}>`, inline: true }, { name: tr('Причина'), value: reason }], 0xf6c343);
  return answer(reply({ content: tr('⚠️ <@{0}> е предупреден (общо {1}).', t.id, n) }, true));
}

export async function timeout(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.moderate)) stop(tr('Нямаш право да заглушаваш.'));
  const t = target(ctx);
  const minutes = Math.max(1, Math.min(MAX_TIMEOUT_MIN, Math.round(Number(opt(ctx.i, tr('минути')) ?? 60))));
  const reason = (opt(ctx.i, tr('причина')) ?? '').trim().slice(0, 500) || tr('Без причина');
  const until = new Date(ctx.now.getTime() + minutes * 60_000);
  const alsoGame = opt(ctx.i, tr('и-в-играта')) === 'true';
  if (alsoGame && !(ctx.me && isStaff(ctx.me.role))) stop(tr('Чатът в играта се заглушава само от екипа на играта (свързан акаунт).'));
  await discord('PATCH', `/guilds/${discordConfig().guildId}/members/${t.id}`, { communication_disabled_until: until.toISOString() }).catch(discordFail);
  const { user: u, sanctionId } = await record(ctx, t, 'timeout', reason, until, alsoGame);
  let inGame = false;
  if (alsoGame && u) {
    await ctx.db.update(users).set({ chatMutedUntil: until }).where(eq(users.id, u.id));
    await notify(ctx.db, u.id, 'warning', () => tr('Ограничение в чата'), () => tr('Заради нарушение на правилата не можеш да пишеш в чата и лични съобщения до {0}.', until.toLocaleString(intlLocale(), { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })), '/game/support');
    inGame = true;
  }
  await dm(ctx, t.id, tr('🔇 Заглушен'), tr('Не можеш да пишеш в сървъра на TransVerse до {0}{1}.\n**Причина:** {2}', when(until), inGame ? tr(' — и в чата на играта') : '', reason), 0xf97316, sanctionId);
  await log(ctx, 'warnings', tr('🔇 Заглушаване'), [{ name: tr('Член'), value: `<@${t.id}> (${t.name})`, inline: true }, { name: tr('Модератор'), value: `<@${ctx.discordId}>`, inline: true }, { name: tr('До'), value: `${when(until)}${inGame ? tr(' · и в играта') : ''}`, inline: true }, { name: tr('Причина'), value: reason }], 0xf97316);
  return answer(reply({ content: tr('🔇 <@{0}> е заглушен до {1}{2}.', t.id, when(until), inGame ? tr(' (и в играта)') : '') }, true));
}

export async function ban(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.ban)) stop(tr('Нямаш право да баниш.'));
  const t = target(ctx);
  const reason = (opt(ctx.i, tr('причина')) ?? '').trim().slice(0, 500) || tr('Без причина');
  const purge = opt(ctx.i, tr('изтрий-съобщенията')) === 'true';
  const { sanctionId } = await record(ctx, t, 'ban', reason, null);
  // The message first: after the ban the bot can no longer reach them (the appeal button still works in the DM).
  await discord<{ id: string }>('POST', '/users/@me/channels', { recipient_id: t.id })
    .then((c) => discord('POST', `/channels/${c.id}/messages`, dmMessage(tr('🔨 Бан'), tr('Баннат си от сървъра на TransVerse.\n**Причина:** {0}', reason), 0xe04545, sanctionId)))
    .catch(() => undefined);
  await discord('PUT', `/guilds/${discordConfig().guildId}/bans/${t.id}`, { delete_message_seconds: purge ? 86_400 : 0 }).catch(async (e) => {
    await ctx.db.delete(discordSanctions).where(eq(discordSanctions.id, sanctionId));
    return discordFail(e);
  });
  await log(ctx, 'bans', tr('🔨 Бан'), [{ name: tr('Член'), value: `<@${t.id}> (${t.name})`, inline: true }, { name: tr('Модератор'), value: `<@${ctx.discordId}>`, inline: true }, { name: tr('Причина'), value: reason }], 0xe04545);
  return answer(reply({ content: tr('🔨 <@{0}> е баннат.', t.id) }, true));
}

export async function unban(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.ban)) stop(tr('Нямаш право да сваляш бан.'));
  const t = target(ctx);
  await discord('DELETE', `/guilds/${discordConfig().guildId}/bans/${t.id}`).catch(discordFail);
  await record(ctx, t, 'unban', (opt(ctx.i, tr('причина')) ?? '').trim().slice(0, 500) || '—', null);
  await log(ctx, 'bans', tr('✅ Свален бан'), [{ name: tr('Член'), value: `<@${t.id}> (${t.name})`, inline: true }, { name: tr('Модератор'), value: `<@${ctx.discordId}>`, inline: true }], 0x2fd27a);
  return answer(reply({ content: tr('✅ Банът на <@{0}> е свален.', t.id) }, true));
}

const KIND_LABEL: Record<string, string> = { warn: '⚠️ Предупреждение', timeout: '🔇 Заглушаване', ban: '🔨 Бан', unban: '✅ Свален бан' };

export async function history(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.moderate)) stop(tr('Нямаш право да гледаш наказанията.'));
  const t = target(ctx);
  const rows = await ctx.db.select().from(discordSanctions).where(eq(discordSanctions.discordUserId, t.id)).orderBy(desc(discordSanctions.createdAt)).limit(10);
  const [game] = await ctx.db.select({ username: users.username, muted: users.chatMutedUntil }).from(users).where(and(eq(users.discordId, t.id), isNull(users.bannedAt)));
  const lines = rows.map((r) => `${tx(KIND_LABEL[r.kind] ?? r.kind)} · ${when(r.createdAt)} · <@${r.moderatorDiscordId}>${r.until ? tr(' · до {0}', when(r.until)) : ''}${r.inGame ? tr(' · и в играта') : ''}\n> ${r.reason}`);
  return answer(reply({
    embeds: [{
      title: tr('Наказания · {0}', t.name),
      color: 0x9aa3b2,
      description: lines.join('\n') || tr('Няма записани наказания.'),
      fields: game ? [{ name: tr('В играта'), value: `${game.username}${game.muted && game.muted > ctx.now ? tr(' · заглушен до {0}', when(game.muted)) : ''}` }] : [],
    }],
  }, true));
}
