import { createHmac } from 'node:crypto';
import { discordConfig } from './config';

/** A link to a player's /карта picture that only the bot hands out (it shows where their trucks are). */
export function mapCardToken(userId: string, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return createHmac('sha256', `${discordConfig().token}:map`).update(`${userId}:${day}`).digest('hex').slice(0, 20);
}
export const mapCardValid = (userId: string, token: string, now = new Date()) => [now, new Date(now.getTime() - 86_400_000)].some((d) => mapCardToken(userId, d) === token);

/** A link to a company's weekly report picture (posted only in its own channel). */
export const reportToken = (organizationId: string, fromMs: number) => createHmac('sha256', `${discordConfig().token}:report`).update(`${organizationId}:${fromMs}`).digest('hex').slice(0, 20);
