/**
 * The TransVerse Discord bot (v1.3). Its settings come from GitHub Secrets
 * (written to the server by the Deploy workflow): DISCORD_BOT_TOKEN,
 * DISCORD_CLIENT_SECRET, DISCORD_PUBLIC_KEY, DISCORD_APPLICATION_ID,
 * DISCORD_GUILD_ID. Without them the bot simply stays off.
 */
export function discordConfig() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim() ?? '';
  const appId = process.env.DISCORD_APPLICATION_ID?.trim() ?? '';
  const guildId = process.env.DISCORD_GUILD_ID?.trim() ?? '';
  return {
    token,
    appId,
    guildId,
    publicKey: process.env.DISCORD_PUBLIC_KEY?.trim() ?? '',
    clientSecret: process.env.DISCORD_CLIENT_SECRET?.trim() ?? '',
    /** Announcements, roles, channels and messages. */
    bot: !!(token && appId && guildId),
    /** "Свържи Discord" in the settings. */
    oauth: !!(appId && process.env.DISCORD_CLIENT_SECRET?.trim()),
  };
}

export const appUrl = () => (process.env.APP_URL?.trim() || 'https://transverse-bg.com').replace(/\/$/, '');

/** Channels the bot announces in (found by name in the server). */
export const DISCORD_CHANNELS = {
  updates: 'обновления',
  events: 'ивенти',
  battles: 'битки',
  builds: 'строежи',
  news: 'седмичник',
  rankings: 'класации',
  giveaways: 'раздавания',
  welcome: 'добре-дошли',
  logs: 'логове',
  warnings: 'предупреждения',
  bans: 'банове',
} as const;
export type DiscordChannel = keyof typeof DISCORD_CHANNELS;
/** The category the companies' private channels go into (matched without emoji and decorations). */
export const COMPANY_CATEGORY = 'Компании';
/** The category of the support tickets' private channels. */
export const TICKET_CATEGORY = 'Отворени тикети';

/** Roles the bot gives to linked players (created when missing). */
export const DISCORD_ROLES = {
  level10: { name: 'Шофьор 10+', color: 0x22d3ee },
  level20: { name: 'Легенда 20+', color: 0xf6c343 },
  vip: { name: 'VIP', color: 0xa66bff },
  owner: { name: 'Собственик на компания', color: 0xf97316 },
  linked: { name: 'Свързан с играта', color: 0x2fd27a },
  /** Support, admins and the founder of the game: sees the staff channels and the tickets. */
  staff: { name: 'Екип TransVerse', color: 0xe04545 },
} as const;
export type DiscordRole = keyof typeof DISCORD_ROLES;

/**
 * Roles anyone picks in #роли to be pinged by an announcement channel
 * (not managed: the bot never takes them away on its own).
 */
export const PING_ROLES = {
  updates: { name: '🔔 Обновления', label: 'Обновления', emoji: '🆕', channel: 'updates' },
  events: { name: '🔔 Ивенти', label: 'Ивенти', emoji: '🎯', channel: 'events' },
  battles: { name: '🔔 Битки', label: 'Битки', emoji: '⚔️', channel: 'battles' },
  news: { name: '🔔 Седмичник', label: 'Седмичник', emoji: '📰', channel: 'news' },
  giveaways: { name: '🔔 Раздавания', label: 'Раздавания', emoji: '🎁', channel: 'giveaways' },
} as const;
export type PingRole = keyof typeof PING_ROLES;

/** Embed colour of the game. */
export const BRAND = 0xf97316;
