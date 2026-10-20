import { and, asc, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { isStaff } from '@/server/auth/roles';
import type { Database } from '@/server/db/client';
import { companyMessages, jobState, notifications, organizations, users } from '@/server/db/schema';
import { categoryOf, inQuietHours, type PushCategory } from '@/server/push';
import { appUrl, BRAND, discordConfig } from './config';
import { enqueue } from './outbox';

/** Discord direct messages replace phone notifications: every category is on until the player turns it off. */
export const wantsDiscord = (prefs: Partial<Record<string, boolean>> | null | undefined, category: PushCategory) => prefs?.[category] !== false;

async function cursor(db: Database, key: string, table: 'notifications' | 'company_messages') {
  const [row] = await db.select().from(jobState).where(eq(jobState.key, key));
  if (row) return Number((row.value as { id: number }).id);
  // First run: start from now (nothing old is sent).
  const { rows } = await db.execute<{ m: number }>(sql`select coalesce(max(id), 0)::bigint as m from ${sql.identifier(table)}`);
  const id = Number(rows[0]?.m ?? 0);
  await save(db, key, id);
  return id;
}
const save = (db: Database, key: string, id: number) => db.insert(jobState).values({ key, value: { id } }).onConflictDoUpdate({ target: jobState.key, set: { value: { id }, updatedAt: new Date() } });

/** Worker: game notifications of players who asked for them on Discord, as a direct message (several become one). */
export async function relayNotifications(db: Database, now = new Date()) {
  if (!discordConfig().bot) return 0;
  const from = await cursor(db, 'discord-dm-cursor', 'notifications');
  const rows = await db
    .select({ id: notifications.id, userId: notifications.userId, title: notifications.title, body: notifications.body, href: notifications.href, discordId: users.discordId, prefs: users.discordPrefs, quiet: users.quietHours, role: users.role })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(gt(notifications.id, from), isNotNull(users.discordId)))
    .orderBy(asc(notifications.id))
    .limit(500);
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!featureLive('discord_bot', now, isStaff(r.role)) || !wantsDiscord(r.prefs, categoryOf(r.href)) || inQuietHours(r.quiet, now)) continue;
    byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  }
  for (const list of byUser.values()) {
    const last = list.at(-1)!;
    const link = (href: string | null) => `${appUrl()}${href ?? '/game/notifications'}`;
    await enqueue(db, `dm:${last.userId}:${last.id}`, `dm:${last.discordId}`, {
      embeds: [
        list.length === 1
          ? { title: last.title.slice(0, 250), description: `${last.body.slice(0, 1500)}\n\n[Отвори в играта](${link(last.href)})`, color: BRAND, footer: { text: 'TransVerse · известията в Discord се спират от Настройки' } }
          : { title: `${list.length} нови известия в TransVerse`, description: `${list.slice(-6).map((n) => `• **${n.title}** — ${n.body.slice(0, 120)}`).join('\n')}\n\n[Отвори в играта](${link('/game/notifications')})`, color: BRAND, footer: { text: 'TransVerse · известията в Discord се спират от Настройки' } },
      ],
    }, now);
  }
  if (rows.length) await save(db, 'discord-dm-cursor', rows.at(-1)!.id);
  return byUser.size;
}

/** Worker: the game side of the chat bridge — new company chat messages go to the company's Discord channel. */
export async function bridgeCompanyChat(db: Database, now = new Date()) {
  if (!discordConfig().bot) return 0;
  const from = await cursor(db, 'discord-bridge-cursor', 'company_messages');
  // Up to the newest message right now, so nothing written meanwhile is skipped.
  const { rows: top } = await db.execute<{ m: number }>(sql`select coalesce(max(id), 0)::bigint as m from company_messages`);
  const upTo = Number(top[0]?.m ?? from);
  const rows = await db
    .select({ id: companyMessages.id, companyId: companyMessages.companyId, body: companyMessages.body, username: users.username, userId: users.id, avatarVersion: users.avatarVersion })
    .from(companyMessages)
    .innerJoin(users, eq(users.id, companyMessages.userId))
    .innerJoin(organizations, eq(organizations.id, companyMessages.companyId))
    // Written in the game (not the ones that came from Discord), for companies with a channel.
    .where(and(gt(companyMessages.id, from), isNull(companyMessages.discordMessageId), isNull(companyMessages.deletedAt), isNotNull(organizations.discordWebhook), lte(companyMessages.id, upTo)))
    .orderBy(asc(companyMessages.id))
    .limit(200);
  for (const m of rows) {
    await enqueue(db, `bridge:${m.id}`, `company:${m.companyId}`, { content: m.body.slice(0, 1900), username: `${m.username} · TransVerse`.slice(0, 80), avatar_url: `${appUrl()}/api/players/${m.userId}/avatar?v=${m.avatarVersion}` }, now);
  }
  await save(db, 'discord-bridge-cursor', rows.length === 200 ? rows.at(-1)!.id : Math.max(from, upTo));
  return rows.length;
}
