import { eq } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { discordSanctions, users } from '@/server/db/schema';
import { discord, DiscordError } from './api';
import { discordConfig, DISCORD_ROLES } from './config';
import { guild } from './guild';
import { layoutState } from './layout';
import { enqueue } from './outbox';

/**
 * Automatic moderation of messages (on unless turned off in the admin panel):
 * invites to other servers, mass mentions, links from accounts that joined
 * less than a day ago, and flooding (the same text again and again, or many
 * messages in a few seconds). The message goes; the first time the member
 * gets a private note, the second time a warning, from the third a timeout.
 * The team and members with the right to manage messages are not checked.
 */

export const AUTOMOD = {
  newMemberMs: 24 * 3_600_000,
  repeat: { count: 3, windowMs: 30_000 },
  flood: { count: 6, windowMs: 10_000 },
  massMentions: 5,
  strikeWindowMs: 3_600_000,
  timeoutMs: 30 * 60_000,
} as const;

const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i;
const LINK = /https?:\/\/\S+/i;

export interface AutomodMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  webhook_id?: string;
  author: { id: string; bot?: boolean; username?: string };
  member?: { roles?: string[]; joined_at?: string };
  mentions?: unknown[];
  mention_roles?: string[];
}

const recent = new Map<string, { content: string; at: number }[]>();
const strikes = new Map<string, number[]>();

/** Why a message breaks the rules (null = fine). Pure, apart from the recent-messages memory. */
export function automodReason(m: AutomodMessage, now: number): string | null {
  const text = m.content ?? '';
  const list = (recent.get(m.author.id) ?? []).filter((x) => now - x.at < AUTOMOD.repeat.windowMs);
  list.push({ content: text.trim().toLowerCase(), at: now });
  recent.set(m.author.id, list);
  if (recent.size > 5000) recent.delete(recent.keys().next().value!);
  if (INVITE.test(text)) return 'покана към друг сървър';
  if (/@(everyone|here)\b/.test(text) || (m.mentions?.length ?? 0) + (m.mention_roles?.length ?? 0) >= AUTOMOD.massMentions) return 'масово споменаване';
  if (m.member?.joined_at && now - new Date(m.member.joined_at).getTime() < AUTOMOD.newMemberMs && LINK.test(text)) return 'линк от нов член (първите 24 часа)';
  if (text && list.filter((x) => x.content === text.trim().toLowerCase()).length >= AUTOMOD.repeat.count) return 'повтарящо се съобщение';
  if (list.filter((x) => now - x.at < AUTOMOD.flood.windowMs).length >= AUTOMOD.flood.count) return 'твърде много съобщения наведнъж';
  return null;
}

/** Members the rules do not apply to: the team role, administrators, those who manage messages. */
async function exempt(roleIds: string[]) {
  const { roles } = await guild();
  return roles.some((r) => roleIds.includes(r.id) && (r.name === DISCORD_ROLES.staff.name || (BigInt((r as { permissions?: string }).permissions ?? '0') & ((1n << 3n) | (1n << 13n))) !== 0n));
}

export async function automod(db: Database, m: AutomodMessage, now = new Date()) {
  if (m.author.bot || m.webhook_id || m.guild_id !== discordConfig().guildId) return null;
  if ((await layoutState(db)).settings?.automod === false) return null;
  const reason = automodReason(m, now.getTime());
  if (!reason || (await exempt(m.member?.roles ?? []))) return null;
  await discord('DELETE', `/channels/${m.channel_id}/messages/${m.id}`).catch((e) => {
    if (!(e instanceof DiscordError && e.status === 404)) throw e;
  });
  const times = (strikes.get(m.author.id) ?? []).filter((t) => now.getTime() - t < AUTOMOD.strikeWindowMs);
  times.push(now.getTime());
  strikes.set(m.author.id, times);
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, m.author.id));
  let step = 'изтрито';
  if (times.length === 2) {
    await db.insert(discordSanctions).values({ discordUserId: m.author.id, userId: u?.id ?? null, kind: 'warn', reason: `Автомодерация: ${reason}`, moderatorDiscordId: 'automod', createdAt: now });
    step = 'предупреждение';
  } else if (times.length >= 3) {
    const until = new Date(now.getTime() + AUTOMOD.timeoutMs);
    await discord('PATCH', `/guilds/${discordConfig().guildId}/members/${m.author.id}`, { communication_disabled_until: until.toISOString() }).catch(() => undefined);
    await db.insert(discordSanctions).values({ discordUserId: m.author.id, userId: u?.id ?? null, kind: 'timeout', reason: `Автомодерация: ${reason}`, until, moderatorDiscordId: 'automod', createdAt: now });
    step = 'заглушен за 30 минути';
  }
  await enqueue(db, `automod-dm:${m.id}`, `dm:${m.author.id}`, { embeds: [{ color: 0xf6c343, title: '🛡️ Съобщението ти беше премахнато', description: `**Причина:** ${reason}${step === 'изтрито' ? '' : `\n**Следва:** ${step}`}\n\nПрочети #правила — при повторение следва заглушаване.` }] }, now);
  await enqueue(db, `automod-log:${m.id}`, `channel:${step === 'изтрито' ? 'logs' : 'warnings'}`, { ping: false, embeds: [{ color: 0xf6c343, title: `🛡️ Автомодерация · ${step}`, description: `<@${m.author.id}> в <#${m.channel_id}> — ${reason}\n> ${(m.content ?? '').slice(0, 300).replace(/\n/g, ' ')}`, timestamp: now.toISOString() }] }, now);
  return { reason, step };
}

/** For tests: forget the recent messages and strikes. */
export function resetAutomod() {
  recent.clear();
  strikes.clear();
}
