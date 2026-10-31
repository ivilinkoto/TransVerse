import { MESSAGES } from '@/i18n/als';
import { discord } from './api';
import { COMMANDS } from './commands';
import { discordConfig } from './config';

/**
 * The commands' names in English and Russian (v2.0). Discord shows them in
 * the user's language and still sends the Bulgarian name, so the handlers
 * stay the same.
 */
const NAMES: Record<string, [en: string, ru: string]> = {
  профил: ['profile', 'профиль'],
  компания: ['company', 'компания'],
  участък: ['base', 'база'],
  класация: ['ranking', 'рейтинг'],
  камиони: ['trucks', 'грузовики'],
  напомни: ['remind', 'напомнить'],
  опашка: ['queue', 'очередь'],
  игра: ['game', 'игра'],
  старт: ['start', 'старт'],
  курс: ['trip', 'рейс'],
  пазар: ['market', 'рынок'],
  търг: ['auction', 'торги'],
  мисии: ['missions', 'миссии'],
  покани: ['invite', 'пригласить'],
  ранг: ['rank', 'ранг'],
  топ: ['top', 'топ'],
  карта: ['map', 'карта'],
  конвой: ['convoy', 'колонна'],
  финанси: ['finance', 'финансы'],
  дуел: ['duel', 'дуэль'],
  пропуск: ['pass', 'пропуск'],
  борса: ['board', 'биржа'],
  дневна: ['daily', 'ежедневная'],
  рекорди: ['records', 'рекорды'],
  камион: ['truck', 'грузовик'],
  съюз: ['alliance', 'союз'],
  'конвой-голям': ['big-convoy', 'большая-колонна'],
  турнир: ['cup', 'кубок'],
  маршрут: ['route', 'маршрут'],
  държава: ['country', 'страна'],
  предизвикателство: ['challenge', 'испытание'],
  албум: ['album', 'альбом'],
  ивент: ['event', 'ивент'],
  битка: ['battle', 'битва'],
  тикет: ['ticket', 'тикет'],
  свързване: ['link', 'привязка'],
  помощ: ['help', 'помощь'],
  предупреждение: ['warn', 'предупреждение'],
  заглуши: ['mute', 'заглушить'],
  бан: ['ban', 'бан'],
  разбани: ['unban', 'разбанить'],
  наказания: ['penalties', 'наказания'],
  'екип-статистика': ['team-stats', 'статистика-команды'],
  'ивент-старт': ['event-start', 'запуск-ивента'],
  раздаване: ['giveaway', 'раздача'],
  новина: ['news', 'новость'],
  статистика: ['stats', 'статистика'],
  Преведи: ['Translate', 'Перевести'],
  сравни: ['compare', 'сравнить'],
  анкета: ['poll', 'опрос'],
  // Options.
  играч: ['player', 'игрок'],
  име: ['name', 'имя'],
  вид: ['type', 'тип'],
  потребител: ['user', 'пользователь'],
  град: ['city', 'город'],
  номер: ['plate', 'номер'],
  от: ['from', 'откуда'],
  до: ['to', 'куда'],
  причина: ['reason', 'причина'],
  минути: ['minutes', 'минуты'],
  'и-в-играта': ['in-the-game-too', 'и-в-игре'],
  'изтрий-съобщенията': ['delete-messages', 'удалить-сообщения'],
  шаблон: ['template', 'шаблон'],
  часове: ['hours', 'часы'],
  награда: ['reward', 'награда'],
  заглавие: ['title', 'заголовок'],
  текст: ['text', 'текст'],
  въпрос: ['question', 'вопрос'],
  отговори: ['answers', 'ответы'],
  победители: ['winners', 'победители'],
};

// Discord allows up to 100 characters in a description.
const both = (en0: string | undefined, ru0: string | undefined) => {
  const [en, ru] = [en0?.slice(0, 100), ru0?.slice(0, 100)];
  const out: Record<string, string> = {};
  if (en) Object.assign(out, { 'en-US': en, 'en-GB': en });
  if (ru) out.ru = ru;
  return Object.keys(out).length ? out : undefined;
};
const text = (bg: string) => both(MESSAGES.en?.[bg], MESSAGES.ru?.[bg]);
const name = (bg: string) => (NAMES[bg] ? both(...NAMES[bg]) : undefined);

type Item = { readonly name: string; readonly description?: string; readonly options?: readonly Item[]; readonly choices?: readonly Item[] };
function localize(item: Item): Record<string, unknown> {
  return {
    ...item,
    ...(name(item.name) ? { name_localizations: name(item.name) } : item.description ? {} : text(item.name) ? { name_localizations: text(item.name) } : {}),
    ...(item.description && text(item.description) ? { description_localizations: text(item.description) } : {}),
    ...(item.options ? { options: item.options.map(localize) } : {}),
    ...(item.choices ? { choices: item.choices.map(localize) } : {}),
  };
}

/** The command list sent to Discord, with the English and Russian names and descriptions. */
export const localizedCommands = () => (COMMANDS as readonly Item[]).map(localize);

/** Puts the bot's slash commands into the server (instant for one server; same list = no change). */
export async function registerCommands() {
  const { bot, appId, guildId } = discordConfig();
  if (!bot) return 0;
  const done = await discord<unknown[]>('PUT', `/applications/${appId}/guilds/${guildId}/commands`, localizedCommands());
  return done.length;
}
