import { eq } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { users } from '@/server/db/schema';
import type { Embed } from './api';
import { appUrl, BRAND } from './config';
import { guild } from './guild';
import { enqueue } from './outbox';
import { linkButton, rows } from './ui';

/**
 * Server events from the gateway: the welcome for new members and the log
 * for the team (#логове): who joined and left, deleted and edited messages,
 * role changes and bans. Discord sends a deleted message without its text, so
 * the worker remembers the last messages it saw.
 */

interface CachedMessage {
  channelId: string;
  authorId: string;
  content: string;
  attachments: number;
}
const CACHE_SIZE = 5000;
const messages = new Map<string, CachedMessage>();
const memberRoles = new Map<string, string[]>();

export function rememberMessage(m: { id: string; channel_id: string; content?: string; author?: { id: string; bot?: boolean }; attachments?: unknown[] }) {
  if (!m.author || m.author.bot) return;
  messages.set(m.id, { channelId: m.channel_id, authorId: m.author.id, content: m.content ?? '', attachments: m.attachments?.length ?? 0 });
  if (messages.size > CACHE_SIZE) messages.delete(messages.keys().next().value!);
}

const ts = (d = new Date()) => d.toISOString();
const quote = (s: string) => (s ? s.slice(0, 1000).split('\n').map((l) => `> ${l}`).join('\n') : '> *(без текст)*');

function log(db: Database, key: string, embed: Embed) {
  return enqueue(db, `log:${key}:${Date.now()}`, 'channel:logs', { ping: false, embeds: [{ timestamp: ts(), ...embed }] });
}

interface GatewayUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
  avatar?: string | null;
}
const nameOf = (u: GatewayUser) => u.global_name || u.username;
/** A Discord snowflake carries its creation time. */
const createdAt = (id: string) => new Date(Number(BigInt(id) >> 22n) + 1_420_070_400_000);

export async function memberJoined(db: Database, d: { user: GatewayUser; roles?: string[] }) {
  if (d.user.bot) return;
  memberRoles.set(d.user.id, d.roles ?? []);
  const [u] = await db.select({ username: users.username }).from(users).where(eq(users.discordId, d.user.id));
  await log(db, `join:${d.user.id}`, { color: 0x2fd27a, title: '📥 Влезе в сървъра', description: `<@${d.user.id}> · ${nameOf(d.user)}\nАкаунт от <t:${Math.floor(createdAt(d.user.id).getTime() / 1000)}:R>${u ? `\nВ играта: **${u.username}**` : ''}` });
  // The welcome in #добре-дошли (mentions only the new member).
  await enqueue(db, `welcome:${d.user.id}:${Date.now()}`, 'channel:welcome', {
    ping: false,
    content: `<@${d.user.id}>`,
    allowed_mentions: { parse: [], users: [d.user.id] },
    embeds: [{ color: BRAND, title: `👋 Добре дошъл, ${nameOf(d.user)}!`, description: u ? `Радваме се да те видим, **${u.username}**! Акаунтът ти вече е свързан — ролите идват до минута.` : 'Ти си в сървъра на TransVerse — онлайн транспортната стратегия по истински пътища. Свържи акаунта си в #свържи-акаунта и избери известията си в #роли.' }],
    components: u ? [] : rows(linkButton('Играй безплатно', `${appUrl()}/register`, '🚚'), linkButton('Свържи Discord', `${appUrl()}/game/settings#discord`, '🔗')),
  });
  // Not linked yet: a short private hello with the steps.
  if (!u) {
    await enqueue(db, `welcome-dm:${d.user.id}`, `dm:${d.user.id}`, {
      embeds: [{ color: BRAND, title: '🚚 Добре дошъл в TransVerse!', description: 'Ето как да започнеш:\n1. Направи профил в играта (безплатно е).\n2. В **Настройки → Discord** свържи акаунта — получаваш роли, канала на компанията и 10 ТрансКоин.\n3. Пиши ни в #тикети, ако имаш въпрос.' }],
      components: rows(linkButton('Играй', `${appUrl()}/register`, '🎮'), linkButton('Свържи Discord', `${appUrl()}/game/settings#discord`, '🔗')),
    });
  }
}

export async function memberLeft(db: Database, d: { user: GatewayUser }) {
  if (d.user.bot) return;
  memberRoles.delete(d.user.id);
  await log(db, `leave:${d.user.id}`, { color: 0xe04545, title: '📤 Излезе от сървъра', description: `<@${d.user.id}> · ${nameOf(d.user)}` });
}

export async function memberUpdated(db: Database, d: { user: GatewayUser; roles: string[] }) {
  if (d.user.bot) return;
  const before = memberRoles.get(d.user.id);
  memberRoles.set(d.user.id, d.roles);
  // The first time we see a member there is nothing to compare with.
  if (!before) return;
  const added = d.roles.filter((r) => !before.includes(r));
  const removed = before.filter((r) => !d.roles.includes(r));
  if (!added.length && !removed.length) return;
  const { roles } = await guild();
  const name = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  await log(db, `roles:${d.user.id}`, { color: 0x9aa3b2, title: '🎭 Промяна на роли', description: `<@${d.user.id}>${added.length ? `\n➕ ${added.map(name).join(', ')}` : ''}${removed.length ? `\n➖ ${removed.map(name).join(', ')}` : ''}` });
}

export async function messageDeleted(db: Database, d: { id: string; channel_id: string }) {
  const m = messages.get(d.id);
  if (!m) return;
  messages.delete(d.id);
  await log(db, `delete:${d.id}`, { color: 0xe04545, title: '🗑️ Изтрито съобщение', description: `От <@${m.authorId}> в <#${m.channelId}>\n${quote(m.content)}${m.attachments ? `\n📎 ${m.attachments} прикачени` : ''}` });
}

export async function messageEdited(db: Database, d: { id: string; channel_id: string; content?: string; author?: { id: string; bot?: boolean } }) {
  const m = messages.get(d.id);
  // An edit without text (an embed appeared) or of an unknown message: nothing to show.
  if (!m || d.content === undefined || d.content === m.content) return;
  messages.set(d.id, { ...m, content: d.content });
  await log(db, `edit:${d.id}`, { color: 0xf6c343, title: '✏️ Редактирано съобщение', description: `От <@${m.authorId}> в <#${m.channelId}>\n**Преди:**\n${quote(m.content)}\n**След:**\n${quote(d.content)}` });
}

export async function banChanged(db: Database, d: { user: GatewayUser }, banned: boolean) {
  await log(db, `ban:${d.user.id}`, { color: banned ? 0xe04545 : 0x2fd27a, title: banned ? '🔨 Бан' : '✅ Свален бан', description: `<@${d.user.id}> · ${nameOf(d.user)}` });
}
