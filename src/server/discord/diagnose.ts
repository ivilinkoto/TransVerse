import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { discordOutbox, jobState, users } from '@/server/db/schema';
import { discord } from './api';
import { COMMANDS } from './commands';
import { appUrl, DISCORD_CHANNELS, DISCORD_ROLES, discordConfig } from './config';
import { GATEWAY_STALE_MS, GATEWAY_STATE, type GatewayState } from './gateway';
import { channelKey, forgetGuild, isForumType } from './guild';
import { discordRedirectUri } from './link';
import { enqueue } from './outbox';
import { registerCommands } from './register';
import { t } from '@/i18n/t';

export interface DiscordCheck {
  label: string;
  ok: boolean;
  detail: string;
}

interface Overwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}
interface GuildRole {
  id: string;
  name: string;
  permissions: string;
  position: number;
  managed?: boolean;
}
interface GuildChannel {
  id: string;
  name: string;
  type: number;
  permission_overwrites?: Overwrite[];
}

const P = { admin: 1n << 3n, manageChannels: 1n << 4n, view: 1n << 10n, send: 1n << 11n, embed: 1n << 14n, manageRoles: 1n << 28n, manageWebhooks: 1n << 29n };
const SERVER_NEEDS: [bigint, string][] = [[P.manageRoles, 'Manage Roles'], [P.manageChannels, 'Manage Channels'], [P.manageWebhooks, 'Manage Webhooks']];
const CHANNEL_NEEDS: [bigint, string][] = [[P.view, 'View Channel'], [P.send, 'Send Messages'], [P.embed, 'Embed Links']];
const missing = (perms: bigint, needs: [bigint, string][]) => (perms & P.admin ? [] : needs.filter(([bit]) => !(perms & bit)).map(([, name]) => name));

/** Discord's permission rules: server roles, then the channel's overwrites for @everyone, the roles and the member. */
export function channelPermissions(base: bigint, channel: GuildChannel, guildId: string, roleIds: string[], memberId: string) {
  if (base & P.admin) return base;
  let perms = base;
  const ow = channel.permission_overwrites ?? [];
  const everyone = ow.find((o) => o.id === guildId);
  if (everyone) perms = (perms & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n;
  let deny = 0n;
  for (const o of ow) {
    if (o.type === 0 && roleIds.includes(o.id)) {
      allow |= BigInt(o.allow);
      deny |= BigInt(o.deny);
    }
  }
  perms = (perms & ~deny) | allow;
  const member = ow.find((o) => o.type === 1 && o.id === memberId);
  if (member) perms = (perms & ~BigInt(member.deny)) | BigInt(member.allow);
  return perms;
}

const errorText = (e: unknown) => (e as Error).message.replace(/^Discord \w+ \S+: /, '').slice(0, 200);

/**
 * Everything the bot needs, checked live against Discord (admin panel): the
 * secrets, the token, the Developer Portal settings, the bot in the server,
 * its permissions and role order, the commands, the channels, the worker's
 * connection and what failed in the queue.
 */
export async function diagnoseDiscord(db: Database): Promise<DiscordCheck[]> {
  const cfg = discordConfig();
  const checks: DiscordCheck[] = [];
  const add = (label: string, ok: boolean, detail: string) => checks.push({ label, ok, detail });

  const secrets = { DISCORD_BOT_TOKEN: cfg.token, DISCORD_APPLICATION_ID: cfg.appId, DISCORD_GUILD_ID: cfg.guildId, DISCORD_PUBLIC_KEY: cfg.publicKey, DISCORD_CLIENT_SECRET: cfg.clientSecret };
  const absent = Object.entries(secrets).filter(([, v]) => !v).map(([k]) => k);
  add(t('Тайни в GitHub Secrets'), absent.length === 0, absent.length ? t('Липсват: {0}. Добави ги и пусни Deploy.', absent.join(', ')) : t('И петте са на сървъра.'));
  if (!cfg.bot) return checks;

  let botId = '';
  try {
    const me = await discord<{ id: string; username: string }>('GET', '/users/@me');
    botId = me.id;
    add(t('Токен на бота'), true, t('Влиза като {0}.', me.username));
  } catch (e) {
    add(t('Токен на бота'), false, t('Discord не приема токена ({0}). Bot → Reset Token и обнови DISCORD_BOT_TOKEN.', errorText(e)));
    return checks;
  }

  try {
    const app = await discord<{ id: string; interactions_endpoint_url?: string | null; redirect_uris?: string[] }>('GET', '/applications/@me');
    if (app.id !== cfg.appId) add('Application ID', false, t('DISCORD_APPLICATION_ID не съвпада с приложението на токена ({0}).', app.id));
    const endpoint = `${appUrl()}/api/discord/interactions`;
    add(
      'Interactions Endpoint URL',
      !app.interactions_endpoint_url || app.interactions_endpoint_url === endpoint,
      app.interactions_endpoint_url === endpoint
        ? t('Сложен е правилно.')
        : app.interactions_endpoint_url
          ? t('Сочи към {0} — трябва {1} (или го остави празно: тогава командите идват през връзката на worker-а).', app.interactions_endpoint_url, endpoint)
          : t('Празен е — командите идват през връзката на worker-а (работи и така).'),
    );
    const redirect = discordRedirectUri();
    add('OAuth2 Redirect', (app.redirect_uris ?? []).includes(redirect), (app.redirect_uris ?? []).includes(redirect) ? t('Сложен е.') : t('Добави {0} в OAuth2 → Redirects.', redirect));
  } catch (e) {
    add(t('Приложението в Developer Portal'), false, errorText(e));
  }

  let guildName = '';
  try {
    guildName = (await discord<{ name: string }>('GET', `/guilds/${cfg.guildId}`)).name;
    add(t('Ботът е в сървъра'), true, guildName);
  } catch (e) {
    add(t('Ботът е в сървъра'), false, t('Не е ({0}). Покани го с OAuth2 → URL Generator: scopes bot + applications.commands; или DISCORD_GUILD_ID е грешен.', errorText(e)));
    return checks;
  }

  const [roles, member, channels] = await Promise.all([
    discord<GuildRole[]>('GET', `/guilds/${cfg.guildId}/roles`),
    discord<{ roles: string[] }>('GET', `/guilds/${cfg.guildId}/members/${botId}`),
    discord<GuildChannel[]>('GET', `/guilds/${cfg.guildId}/channels`),
  ]);
  const byId = new Map(roles.map((r) => [r.id, r]));
  const everyone = byId.get(cfg.guildId);
  const base = [everyone, ...member.roles.map((id) => byId.get(id))].reduce((acc, r) => acc | BigInt(r?.permissions ?? '0'), 0n);
  const lacking = missing(base, SERVER_NEEDS);
  add(t('Права на бота в сървъра'), lacking.length === 0, lacking.length ? t('Липсват: {0}. Server Settings → Roles → ролята на бота.', lacking.join(', ')) : base & P.admin ? 'Administrator.' : 'Manage Roles, Manage Channels, Manage Webhooks.');

  const top = Math.max(0, ...member.roles.map((id) => byId.get(id)?.position ?? 0));
  const names = new Set<string>(Object.values(DISCORD_ROLES).map((r) => r.name));
  const above = roles.filter((r) => (names.has(r.name) || r.name.startsWith('Компания · ')) && r.position >= top).map((r) => r.name);
  add(t('Ред на ролите'), above.length === 0, above.length ? t('Тези роли са над ролята на бота и той не може да ги дава: {0}. Плъзни ролята на бота над тях в Server Settings → Roles.', above.join(', ')) : t('Ролята на бота е над ролите, които дава.'));

  try {
    const registered = await discord<{ name: string }[]>('GET', `/applications/${cfg.appId}/guilds/${cfg.guildId}/commands`);
    const want = COMMANDS.length;
    add(t('Команди (/помощ …)'), registered.length >= want, registered.length >= want ? t('{0} команди в сървъра.', registered.length) : t('{0} от {1}. Натисни „Поправи“ по-долу.', registered.length, want));
  } catch (e) {
    add(t('Команди (/помощ …)'), false, t('{0}. Покани бота наново със scope applications.commands.', errorText(e)));
  }

  for (const name of Object.values(DISCORD_CHANNELS)) {
    // Text, announcement and (1.1.3.2) forum channels: the bot posts in all of them.
    const ch = channels.find((c) => (c.type === 0 || c.type === 5 || isForumType(c.type)) && channelKey(c.name) === channelKey(name));
    if (!ch) {
      const near = channels.filter((c) => c.name.toLowerCase().includes(name)).map((c) => `#${c.name} [${[...c.name].map((ch) => ch.codePointAt(0)!.toString(16)).join(' ')}]`);
      add(t('Канал #{0}', name), false, near.length ? t('Не разпознах: {0}.', near.join(', ')) : t('Няма такъв канал (обявленията за него се пропускат).'));
      continue;
    }
    const need = missing(channelPermissions(base, ch, cfg.guildId, member.roles, botId), CHANNEL_NEEDS);
    add(t('Канал #{0}', name), need.length === 0, need.length ? t('Ботът няма {0} в #{1}. Edit Channel → Permissions → добави ролята на бота.', need.join(', '), ch.name) : isForumType(ch.type) ? t('#{0} (форум — всяко съобщение е отделна публикация)', ch.name) : `#${ch.name}`);
  }

  const [gw] = await db.select().from(jobState).where(eq(jobState.key, GATEWAY_STATE));
  const state = gw?.value as GatewayState | undefined;
  const gwCheck = gatewayCheck(state, Date.now());
  add(t('Връзка на worker-а с Discord'), gwCheck.ok, gwCheck.text);

  const [linkedRow] = await db.select({ linked: sql<number>`count(*)::int` }).from(users).where(isNotNull(users.discordId));
  const [pendingRow] = await db.select({ pending: sql<number>`count(*)::int` }).from(discordOutbox).where(isNull(discordOutbox.sentAt));
  const failed = await db.select({ target: discordOutbox.target, error: discordOutbox.lastError }).from(discordOutbox).where(isNotNull(discordOutbox.lastError)).orderBy(desc(discordOutbox.id)).limit(3);
  add(t('Опашка към Discord'), failed.length === 0, t('{0} свързани играчи · {1} чакащи{2}', linkedRow?.linked ?? 0, pendingRow?.pending ?? 0, failed.length ? t(' · последни грешки: {0}', failed.map((f) => `${f.target}: ${f.error}`).join(' | ')) : ''));
  return checks;
}

/** "Поправи": the commands again, fresh server data and every linked player's roles soon. */
export async function repairDiscord(db: Database, now = new Date()) {
  if (!discordConfig().bot) return { commands: 0, players: 0 };
  forgetGuild();
  const commands = await registerCommands();
  const linked = await db.select({ id: users.id }).from(users).where(and(isNotNull(users.discordId), isNull(users.bannedAt)));
  for (const u of linked) await enqueue(db, `roles:${u.id}:${now.getTime()}`, 'job:roles', { userId: u.id }, now);
  return { commands, players: linked.length };
}

const CLOSE_CODES: Record<number, string> = { 4004: 'грешен токен (DISCORD_BOT_TOKEN)', 4013: 'невалидни intents', 4014: 'не са включени Server Members Intent и Message Content Intent (Bot → Privileged Gateway Intents)' };

const ago = (ms: number) => (ms < 90_000 ? t('преди малко') : ms < 90 * 60_000 ? t('преди {0} мин', Math.round(ms / 60_000)) : t('преди {0} ч', Math.round(ms / 3_600_000)));

/** The worker's gateway connection in plain words, from the state it saves (and how old it is). */
export function gatewayCheck(state: GatewayState | undefined, now: number): { ok: boolean; text: string } {
  if (!state) return { ok: false, text: t('Още няма данни — worker-ът не е стартирал с тази версия.') };
  const age = now - state.at;
  if (state.state === 'ready') {
    if (age > GATEWAY_STALE_MS) return { ok: false, text: t('Последен знак от worker-а {0} — вероятно е спрян. Провери дали worker-ът работи (логовете на сървъра).', ago(age)) };
    if (state.limited) return { ok: false, text: t('Свързан без Server Members и Message Content: командите и бутоните работят, но няма посрещане, логове на съобщенията и мост от Discord към играта. Включи двата intent-а (Bot → Privileged Gateway Intents) — ботът опитва пак на всеки 30 минути.') };
    return { ok: true, text: t('Свързан.') };
  }
  if (state.state === 'connecting') {
    return age < 2 * 60_000
      ? { ok: true, text: t('Свързва се в момента — провери пак след минута.') }
      : { ok: false, text: t('Свързва се {0} без успех. Ако worker-ът работи, рестартирай го; ако не помогне — провери токена и дали сървърът стига до gateway.discord.gg.', ago(age)) };
  }
  const why = state.code && CLOSE_CODES[state.code] ? CLOSE_CODES[state.code] : t('код {0}{1}', state.code ?? '—', state.error ? ` — ${state.error}` : '');
  return { ok: false, text: t('Затворена ({0}): {1}.', ago(age), why) };
}
