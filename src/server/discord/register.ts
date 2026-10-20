import { discord } from './api';
import { COMMANDS } from './commands';
import { discordConfig } from './config';

/** Puts the bot's slash commands into the server (instant for one server; same list = no change). */
export async function registerCommands() {
  const { bot, appId, guildId } = discordConfig();
  if (!bot) return 0;
  const done = await discord<unknown[]>('PUT', `/applications/${appId}/guilds/${guildId}/commands`, COMMANDS);
  return done.length;
}
