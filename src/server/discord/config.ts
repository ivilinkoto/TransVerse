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
  quiz: 'викторина',
  photos: 'снимки',
  botCommands: 'бот-команди',
  dailyLoad: 'товар-на-деня',
  convoys: 'конвои',
  usedMarket: 'пазар-камиони',
  livery: 'ливреи',
  rally: 'рали',
  staffAlerts: 'сигнали',
  // 1.1.3.2
  ideas: 'идеи',
  bugs: 'докладвай-бъг',
  status: 'статус',
  teamNews: 'новини',
  polls: 'анкети',
} as const;
export type DiscordChannel = keyof typeof DISCORD_CHANNELS;

/**
 * The English and Russian channels (v2.0): the same announcements, written in
 * that language. A channel missing here (or in the server) gets nothing.
 */
export const LOCALE_CHANNELS: Record<'en' | 'ru', Partial<Record<DiscordChannel, string>>> = {
  en: { updates: 'en-updates', events: 'en-events', battles: 'en-battles', news: 'en-weekly', rankings: 'en-rankings', dailyLoad: 'en-load-of-the-day', convoys: 'en-convoys', rally: 'en-rally' },
  ru: { updates: 'ru-обновления', events: 'ru-ивенты', battles: 'ru-битвы', news: 'ru-еженедельник', rankings: 'ru-рейтинги', dailyLoad: 'ru-груз-дня', convoys: 'ru-колонны', rally: 'ru-ралли' },
};
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
  /** The company's division this month (v1.5). */
  divisionGold: { name: '🥇 Златна дивизия', color: 0xf6c343 },
  divisionSilver: { name: '🥈 Сребърна дивизия', color: 0xcbd5e1 },
  divisionBronze: { name: '🥉 Бронзова дивизия', color: 0xb45309 },
  /** 10+ perfect trips in a row right now (v1.5): goes away when the streak breaks. */
  perfect10: { name: '💎 Перфектна серия 10+', color: 0x34d399 },
  /** Support, admins and the founder of the game: sees the staff channels and the tickets. */
  staff: { name: 'Екип TransVerse', color: 0xe04545 },
} as const;
export type DiscordRole = keyof typeof DISCORD_ROLES;

/** Badges from the game that become a role in the server (given and taken by the bot like the roles above). */
export const BADGE_ROLES: Record<string, { name: string; color: number }> = {
  'pumpkin-2026': { name: '🎃 Тиквен шофьор 2026', color: 0xf97316 },
  'santa-2026': { name: '🎄 Коледен шофьор 2026', color: 0xef4444 },
  'ghost-hunter': { name: '👻 Ловец на призраци', color: 0x94a3b8 },
  legend: { name: '🏆 Легенда на пътя', color: 0xf6c343 },
  mentor: { name: '🧭 Наставник', color: 0x2fd27a },
  architect: { name: '🏛️ Архитект', color: 0x22d3ee },
  skyscraper: { name: '🏙️ Небостъргач', color: 0x60a5fa },
  builder: { name: '🧱 Строител', color: 0xca8a04 },
  'news-star': { name: '📰 Звезда на седмичника', color: 0xe5e7eb },
  partner: { name: '🤝 Верен партньор', color: 0x0e7490 },
  duelist: { name: '⚔️ Дуелист', color: 0xe04545 },
  'livery-star': { name: '🎨 Ливрея на месеца', color: 0xa66bff },
  'team-haul': { name: '📦 Отборен товар', color: 0x65a30d },
};

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
  quiz: { name: '🔔 Викторина', label: 'Викторина', emoji: '🧠', channel: 'quiz' },
  dailyLoad: { name: '🔔 Товар на деня', label: 'Товар на деня', emoji: '⭐', channel: 'dailyLoad' },
  convoys: { name: '🔔 Конвои', label: 'Конвои', emoji: '🚚', channel: 'convoys' },
  teamNews: { name: '🔔 Новини', label: 'Новини', emoji: '📣', channel: 'teamNews' },
  polls: { name: '🔔 Анкети', label: 'Анкети', emoji: '📊', channel: 'polls' },
} as const;
export type PingRole = keyof typeof PING_ROLES;

/**
 * Members who pressed "Не съм бот" (when the check is on, see verify.ts): the
 * rest of the server opens for them. Not managed: the bot never takes it away.
 */
export const VERIFIED_ROLE = { name: '✅ Проверен', color: 0x2fd27a } as const;

/** Embed colour of the game. */
export const BRAND = 0xf97316;
