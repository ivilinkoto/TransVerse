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
} as const;
export type DiscordChannel = keyof typeof DISCORD_CHANNELS;
/** The category the companies' private channels go into. */
export const COMPANY_CATEGORY = 'Компании';

/** Roles the bot gives to linked players (created when missing). */
export const DISCORD_ROLES = {
  level10: { name: 'Шофьор 10+', color: 0x22d3ee },
  level20: { name: 'Легенда 20+', color: 0xf6c343 },
  vip: { name: 'VIP', color: 0xa66bff },
  owner: { name: 'Собственик на компания', color: 0xf97316 },
  linked: { name: 'Свързан с играта', color: 0x2fd27a },
} as const;
export type DiscordRole = keyof typeof DISCORD_ROLES;

/** Embed colour of the game. */
export const BRAND = 0xf97316;
