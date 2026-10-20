import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { discordOutbox, jobState, users } from '@/server/db/schema';
import { discord } from './api';
import { COMMANDS } from './commands';
import { appUrl, DISCORD_CHANNELS, DISCORD_ROLES, discordConfig } from './config';
import { GATEWAY_STATE, type GatewayState } from './gateway';
import { channelKey, forgetGuild } from './guild';
import { discordRedirectUri } from './link';
import { enqueue } from './outbox';
import { registerCommands } from './register';

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
  add('Тайни в GitHub Secrets', absent.length === 0, absent.length ? `Липсват: ${absent.join(', ')}. Добави ги и пусни Deploy.` : 'И петте са на сървъра.');
  if (!cfg.bot) return checks;

  let botId = '';
  try {
    const me = await discord<{ id: string; username: string }>('GET', '/users/@me');
    botId = me.id;
    add('Токен на бота', true, `Влиза като ${me.username}.`);
  } catch (e) {
    add('Токен на бота', false, `Discord не приема токена (${errorText(e)}). Bot → Reset Token и обнови DISCORD_BOT_TOKEN.`);
    return checks;
  }

  try {
    const app = await discord<{ id: string; interactions_endpoint_url?: string | null; redirect_uris?: string[] }>('GET', '/applications/@me');
    if (app.id !== cfg.appId) add('Application ID', false, `DISCORD_APPLICATION_ID не съвпада с приложението на токена (${app.id}).`);
    const endpoint = `${appUrl()}/api/discord/interactions`;
    add(
      'Interactions Endpoint URL',
      !app.interactions_endpoint_url || app.interactions_endpoint_url === endpoint,
      app.interactions_endpoint_url === endpoint
        ? 'Сложен е правилно.'
        : app.interactions_endpoint_url
          ? `Сочи към ${app.interactions_endpoint_url} — трябва ${endpoint} (или го остави празно: тогава командите идват през връзката на worker-а).`
          : 'Празен е — командите идват през връзката на worker-а (работи и така).',
    );
    const redirect = discordRedirectUri();
    add('OAuth2 Redirect', (app.redirect_uris ?? []).includes(redirect), (app.redirect_uris ?? []).includes(redirect) ? 'Сложен е.' : `Добави ${redirect} в OAuth2 → Redirects.`);
  } catch (e) {
    add('Приложението в Developer Portal', false, errorText(e));
  }

  let guildName = '';
  try {
    guildName = (await discord<{ name: string }>('GET', `/guilds/${cfg.guildId}`)).name;
    add('Ботът е в сървъра', true, guildName);
  } catch (e) {
    add('Ботът е в сървъра', false, `Не е (${errorText(e)}). Покани го с OAuth2 → URL Generator: scopes bot + applications.commands; или DISCORD_GUILD_ID е грешен.`);
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
  add('Права на бота в сървъра', lacking.length === 0, lacking.length ? `Липсват: ${lacking.join(', ')}. Server Settings → Roles → ролята на бота.` : base & P.admin ? 'Administrator.' : 'Manage Roles, Manage Channels, Manage Webhooks.');

  const top = Math.max(0, ...member.roles.map((id) => byId.get(id)?.position ?? 0));
  const names = new Set<string>(Object.values(DISCORD_ROLES).map((r) => r.name));
  const above = roles.filter((r) => (names.has(r.name) || r.name.startsWith('Компания · ')) && r.position >= top).map((r) => r.name);
  add('Ред на ролите', above.length === 0, above.length ? `Тези роли са над ролята на бота и той не може да ги дава: ${above.join(', ')}. Плъзни ролята на бота над тях в Server Settings → Roles.` : 'Ролята на бота е над ролите, които дава.');

  try {
    const registered = await discord<{ name: string }[]>('GET', `/applications/${cfg.appId}/guilds/${cfg.guildId}/commands`);
    const want = COMMANDS.length;
    add('Команди (/помощ …)', registered.length >= want, registered.length >= want ? `${registered.length} команди в сървъра.` : `${registered.length} от ${want}. Натисни „Поправи“ по-долу.`);
  } catch (e) {
    add('Команди (/помощ …)', false, `${errorText(e)}. Покани бота наново със scope applications.commands.`);
  }

  for (const name of Object.values(DISCORD_CHANNELS)) {
    const ch = channels.find((c) => (c.type === 0 || c.type === 5) && channelKey(c.name) === channelKey(name));
    if (!ch) {
      const near = channels.filter((c) => c.name.toLowerCase().includes(name)).map((c) => `#${c.name} [${[...c.name].map((ch) => ch.codePointAt(0)!.toString(16)).join(' ')}]`);
      add(`Канал #${name}`, false, near.length ? `Не разпознах: ${near.join(', ')}.` : 'Няма такъв канал (обявленията за него се пропускат).');
      continue;
    }
    const need = missing(channelPermissions(base, ch, cfg.guildId, member.roles, botId), CHANNEL_NEEDS);
    add(`Канал #${name}`, need.length === 0, need.length ? `Ботът няма ${need.join(', ')} в #${ch.name}. Edit Channel → Permissions → добави ролята на бота.` : `#${ch.name}`);
  }

  const [gw] = await db.select().from(jobState).where(eq(jobState.key, GATEWAY_STATE));
  const state = gw?.value as GatewayState | undefined;
  const intents: Record<number, string> = { 4004: 'грешен токен', 4013: 'невалидни intents', 4014: 'не са включени Server Members Intent и Message Content Intent (Bot → Privileged Gateway Intents)' };
  add(
    'Връзка на worker-а с Discord',
    state?.state === 'ready' && !state.limited,
    !state
      ? 'Още няма данни — worker-ът не е стартирал с тази версия.'
      : state.state === 'ready' && state.limited
        ? 'Свързан без Server Members и Message Content: командите и бутоните работят, но няма посрещане, логове на съобщенията и мост от Discord към играта. Включи двата intent-а (Bot → Privileged Gateway Intents) — ботът опитва пак на всеки 30 минути.'
        : state.state === 'ready'
          ? 'Свързан.'
          : state.code && intents[state.code] ? `Затворена: ${intents[state.code]}.` : `Състояние: ${state.state}${state.code ? ` (код ${state.code})` : ''}${state.error ? ` — ${state.error}` : ''}.`,
  );

  const [linkedRow] = await db.select({ linked: sql<number>`count(*)::int` }).from(users).where(isNotNull(users.discordId));
  const [pendingRow] = await db.select({ pending: sql<number>`count(*)::int` }).from(discordOutbox).where(isNull(discordOutbox.sentAt));
  const failed = await db.select({ target: discordOutbox.target, error: discordOutbox.lastError }).from(discordOutbox).where(isNotNull(discordOutbox.lastError)).orderBy(desc(discordOutbox.id)).limit(3);
  add('Опашка към Discord', failed.length === 0, `${linkedRow?.linked ?? 0} свързани играчи · ${pendingRow?.pending ?? 0} чакащи${failed.length ? ` · последни грешки: ${failed.map((f) => `${f.target}: ${f.error}`).join(' | ')}` : ''}`);
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
