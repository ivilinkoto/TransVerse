import { discord, DiscordError } from './api';
import { BADGE_ROLES, discordConfig, DISCORD_ROLES, PING_ROLES, VERIFIED_ROLE, type DiscordRole } from './config';

interface Channel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
}
interface Role {
  id: string;
  name: string;
}

let cache: { at: number; channels: Channel[]; roles: Role[]; botId: string } | null = null;

/** The server's channels and roles, and the bot's own user id (kept for a few minutes). */
export async function guild(force = false) {
  if (!force && cache && Date.now() - cache.at < 5 * 60_000) return cache;
  const { guildId } = discordConfig();
  const [channels, roles, me] = await Promise.all([discord<Channel[]>('GET', `/guilds/${guildId}/channels`), discord<Role[]>('GET', `/guilds/${guildId}/roles`), discord<{ id: string }>('GET', '/users/@me')]);
  cache = { at: Date.now(), channels, roles, botId: me.id };
  return cache;
}
export const forgetGuild = () => {
  cache = null;
};

/**
 * A channel name without "#", emoji and decorations around it: "📢-обновления",
 * "💻ǀǀобновления" (Discord does not allow "|", so servers use look-alike
 * letters such as ǀ) and "#обновления" all become "обновления".
 */
export const channelKey = (name: string) =>
  name
    .normalize('NFKC')
    .toLowerCase()
    // The Cyrillic "палочка" (Ӏ) looks like "|" too.
    .replace(/[^\p{L}\p{N}-]|[\u04c0\u04cf]/gu, '')
    .replace(/^[^a-z0-9\p{Script=Cyrillic}]+|[^a-z0-9\p{Script=Cyrillic}]+$/gu, '');

/** A text channel by name (as shown in Discord, with or without "#" and emoji). */
export async function channelByName(name: string) {
  const { channels } = await guild();
  return channels.find((c) => (c.type === 0 || c.type === 5) && channelKey(c.name) === channelKey(name)) ?? null;
}

/** A role by name; created (no permissions, not mentionable) when it is missing. */
export async function ensureRole(name: string, color: number): Promise<string> {
  const { roles } = await guild();
  const found = roles.find((r) => r.name === name);
  if (found) return found.id;
  const role = await discord<Role>('POST', `/guilds/${discordConfig().guildId}/roles`, { name, color, permissions: '0', mentionable: false, hoist: false });
  cache?.roles.push(role);
  return role.id;
}

export const gameRole = (key: DiscordRole) => ensureRole(DISCORD_ROLES[key].name, DISCORD_ROLES[key].color);

/** Roles the bot manages (so it never touches the server's own roles). */
export async function managedRoleIds(extra: string[] = []) {
  const { roles } = await guild();
  const names = new Set<string>([...Object.values(DISCORD_ROLES), ...Object.values(BADGE_ROLES)].map((r) => r.name));
  return new Set([...roles.filter((r) => names.has(r.name)).map((r) => r.id), ...extra]);
}

/** The pick-your-pings role of an announcement channel, if it exists (never made here). */
export async function pingRoleFor(channel: string) {
  const entry = Object.values(PING_ROLES).find((r) => r.channel === channel);
  if (!entry) return null;
  const { roles } = await guild();
  return roles.find((r) => r.name === entry.name)?.id ?? null;
}

/** "✅ Проверен" (the new members' check, see check.ts). */
export const verifiedRole = () => ensureRole(VERIFIED_ROLE.name, VERIFIED_ROLE.color);

export async function giveVerified(discordId: string) {
  const role = await verifiedRole();
  await discord('PUT', `/guilds/${discordConfig().guildId}/members/${discordId}/roles/${role}`).catch((e) => {
    if (!(e instanceof DiscordError && e.status === 404)) throw e;
  });
}
