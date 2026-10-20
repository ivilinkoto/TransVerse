import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { isStaff } from '@/server/auth/roles';
import { adminAudit, discordSanctions, users } from '@/server/db/schema';
import { notify } from '@/server/game/notify';
import { discord, DiscordError } from './api';
import { answer, hasPerm, opt, PERM, stop, type Answer, type Ctx } from './context';
import { discordConfig } from './config';
import { enqueue } from './outbox';
import { reply } from './ui';

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
  const id = opt(ctx.i, 'потребител');
  if (!id) stop('Избери потребител.');
  const u = ctx.i.data?.resolved?.users?.[id!];
  if (u?.bot) stop('Ботовете не се наказват.');
  if (id === ctx.discordId) stop('Не можеш да наказваш себе си.');
  return { id: id!, name: u?.global_name || u?.username || id! };
}

async function linkedUser(ctx: Ctx, discordId: string) {
  const [u] = await ctx.db.select({ id: users.id, username: users.username }).from(users).where(eq(users.discordId, discordId));
  return u ?? null;
}

const dm = (ctx: Ctx, discordId: string, title: string, description: string, color: number) =>
  enqueue(ctx.db, `mod-dm:${discordId}:${ctx.now.getTime()}`, `dm:${discordId}`, { embeds: [{ title, description, color, footer: { text: 'Сървърът на TransVerse · при въпрос — отвори тикет' } }] }, ctx.now);
const log = (ctx: Ctx, channel: 'warnings' | 'bans', title: string, fields: { name: string; value: string; inline?: boolean }[], color: number) =>
  enqueue(ctx.db, `mod-log:${channel}:${ctx.now.getTime()}:${ctx.discordId}`, `channel:${channel}`, { ping: false, embeds: [{ title, color, fields, timestamp: ctx.now.toISOString() }] }, ctx.now);

async function record(ctx: Ctx, t: { id: string }, kind: string, reason: string, until: Date | null, inGame = false) {
  const u = await linkedUser(ctx, t.id);
  await ctx.db.insert(discordSanctions).values({ discordUserId: t.id, userId: u?.id ?? null, kind, reason, until, inGame, moderatorDiscordId: ctx.discordId, moderatorUserId: ctx.me?.id ?? null, createdAt: ctx.now });
  // In the game's audit log when the moderator is linked.
  if (ctx.me) await ctx.db.insert(adminAudit).values({ actorId: ctx.me.id, action: `discord_${kind}`, targetUserId: u?.id ?? null, details: { discordUserId: t.id, reason, until: until?.toISOString() ?? null, inGame } });
  return u;
}

const discordFail = (e: unknown): never => {
  if (e instanceof DiscordError && (e.status === 403 || e.status === 404)) stop('Discord не позволи — членът е с по-висока роля от бота или вече не е в сървъра.');
  throw e;
};

export async function warn(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.moderate)) stop('Нямаш право да предупреждаваш.');
  const t = target(ctx);
  const reason = (opt(ctx.i, 'причина') ?? '').trim().slice(0, 500) || 'Без причина';
  await record(ctx, t, 'warn', reason, null);
  const [{ n = 0 } = {}] = await ctx.db.select({ n: count() }).from(discordSanctions).where(and(eq(discordSanctions.discordUserId, t.id), eq(discordSanctions.kind, 'warn')));
  await dm(ctx, t.id, '⚠️ Предупреждение', `Получаваш предупреждение в сървъра на TransVerse.\n**Причина:** ${reason}\n\nМоля, спазвай #правила — при повторно нарушение следва заглушаване или бан.`, 0xf6c343);
  await log(ctx, 'warnings', `⚠️ Предупреждение № ${n}`, [{ name: 'Член', value: `<@${t.id}> (${t.name})`, inline: true }, { name: 'Модератор', value: `<@${ctx.discordId}>`, inline: true }, { name: 'Причина', value: reason }], 0xf6c343);
  return answer(reply({ content: `⚠️ <@${t.id}> е предупреден (общо ${n}).` }, true));
}

export async function timeout(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.moderate)) stop('Нямаш право да заглушаваш.');
  const t = target(ctx);
  const minutes = Math.max(1, Math.min(MAX_TIMEOUT_MIN, Math.round(Number(opt(ctx.i, 'минути') ?? 60))));
  const reason = (opt(ctx.i, 'причина') ?? '').trim().slice(0, 500) || 'Без причина';
  const until = new Date(ctx.now.getTime() + minutes * 60_000);
  const alsoGame = opt(ctx.i, 'и-в-играта') === 'true';
  if (alsoGame && !(ctx.me && isStaff(ctx.me.role))) stop('Чатът в играта се заглушава само от екипа на играта (свързан акаунт).');
  await discord('PATCH', `/guilds/${discordConfig().guildId}/members/${t.id}`, { communication_disabled_until: until.toISOString() }).catch(discordFail);
  const u = await record(ctx, t, 'timeout', reason, until, alsoGame);
  let inGame = false;
  if (alsoGame && u) {
    await ctx.db.update(users).set({ chatMutedUntil: until }).where(eq(users.id, u.id));
    await notify(ctx.db, u.id, 'warning', 'Ограничение в чата', `Заради нарушение на правилата не можеш да пишеш в чата и лични съобщения до ${until.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`, '/game/support');
    inGame = true;
  }
  await dm(ctx, t.id, '🔇 Заглушен', `Не можеш да пишеш в сървъра на TransVerse до ${when(until)}${inGame ? ' — и в чата на играта' : ''}.\n**Причина:** ${reason}`, 0xf97316);
  await log(ctx, 'warnings', '🔇 Заглушаване', [{ name: 'Член', value: `<@${t.id}> (${t.name})`, inline: true }, { name: 'Модератор', value: `<@${ctx.discordId}>`, inline: true }, { name: 'До', value: `${when(until)}${inGame ? ' · и в играта' : ''}`, inline: true }, { name: 'Причина', value: reason }], 0xf97316);
  return answer(reply({ content: `🔇 <@${t.id}> е заглушен до ${when(until)}${inGame ? ' (и в играта)' : ''}.` }, true));
}

export async function ban(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.ban)) stop('Нямаш право да баниш.');
  const t = target(ctx);
  const reason = (opt(ctx.i, 'причина') ?? '').trim().slice(0, 500) || 'Без причина';
  const purge = opt(ctx.i, 'изтрий-съобщенията') === 'true';
  // The message first: after the ban the bot can no longer reach them.
  await discord<{ id: string }>('POST', '/users/@me/channels', { recipient_id: t.id })
    .then((c) => discord('POST', `/channels/${c.id}/messages`, { embeds: [{ title: '🔨 Бан', color: 0xe04545, description: `Баннат си от сървъра на TransVerse.\n**Причина:** ${reason}` }] }))
    .catch(() => undefined);
  await discord('PUT', `/guilds/${discordConfig().guildId}/bans/${t.id}`, { delete_message_seconds: purge ? 86_400 : 0 }).catch(discordFail);
  await record(ctx, t, 'ban', reason, null);
  await log(ctx, 'bans', '🔨 Бан', [{ name: 'Член', value: `<@${t.id}> (${t.name})`, inline: true }, { name: 'Модератор', value: `<@${ctx.discordId}>`, inline: true }, { name: 'Причина', value: reason }], 0xe04545);
  return answer(reply({ content: `🔨 <@${t.id}> е баннат.` }, true));
}

export async function unban(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.ban)) stop('Нямаш право да сваляш бан.');
  const t = target(ctx);
  await discord('DELETE', `/guilds/${discordConfig().guildId}/bans/${t.id}`).catch(discordFail);
  await record(ctx, t, 'unban', (opt(ctx.i, 'причина') ?? '').trim().slice(0, 500) || '—', null);
  await log(ctx, 'bans', '✅ Свален бан', [{ name: 'Член', value: `<@${t.id}> (${t.name})`, inline: true }, { name: 'Модератор', value: `<@${ctx.discordId}>`, inline: true }], 0x2fd27a);
  return answer(reply({ content: `✅ Банът на <@${t.id}> е свален.` }, true));
}

const KIND_LABEL: Record<string, string> = { warn: '⚠️ Предупреждение', timeout: '🔇 Заглушаване', ban: '🔨 Бан', unban: '✅ Свален бан' };

export async function history(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.moderate)) stop('Нямаш право да гледаш наказанията.');
  const t = target(ctx);
  const rows = await ctx.db.select().from(discordSanctions).where(eq(discordSanctions.discordUserId, t.id)).orderBy(desc(discordSanctions.createdAt)).limit(10);
  const [game] = await ctx.db.select({ username: users.username, muted: users.chatMutedUntil }).from(users).where(and(eq(users.discordId, t.id), isNull(users.bannedAt)));
  const lines = rows.map((r) => `${KIND_LABEL[r.kind] ?? r.kind} · ${when(r.createdAt)} · <@${r.moderatorDiscordId}>${r.until ? ` · до ${when(r.until)}` : ''}${r.inGame ? ' · и в играта' : ''}\n> ${r.reason}`);
  return answer(reply({
    embeds: [{
      title: `Наказания · ${t.name}`,
      color: 0x9aa3b2,
      description: lines.join('\n') || 'Няма записани наказания.',
      fields: game ? [{ name: 'В играта', value: `${game.username}${game.muted && game.muted > ctx.now ? ` · заглушен до ${when(game.muted)}` : ''}` }] : [],
    }],
  }, true));
}
