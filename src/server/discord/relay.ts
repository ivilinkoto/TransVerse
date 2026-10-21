import { and, asc, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { money } from '@/lib/format';
import { featureLive } from '@/lib/game/features';
import { ROADSIDE } from '@/lib/game/roadside';
import { isStaff } from '@/server/auth/roles';
import type { Database } from '@/server/db/client';
import { cities, companies, companyMessages, contracts, deliveries, jobState, notifications, organizations, users, vehicles } from '@/server/db/schema';
import { categoryOf, inQuietHours, type PushCategory } from '@/server/push';
import { appUrl, BRAND, discordConfig } from './config';
import { enqueue } from './outbox';
import { button, linkButton, rows as buttonRows, STYLE } from './ui';

/** Discord direct messages: every category is on until the player turns it off (like phone notifications). */
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

/** Buttons that act on a notification right in Discord, from the link it carries. */
export function actionButtons(href: string | null, staff: boolean, now: Date) {
  const id = (key: string) => new RegExp(`[?&]${key}=([0-9a-f-]{36})`).exec(href ?? '')?.[1];
  // A truck arrived: "Нов курс" picks its next load right here (see play.ts).
  const truck = id('truck');
  if (truck) return [button('Нов курс за този камион', `course:truck:${truck}`, STYLE.primary, '🚚')];
  // A load on a favourite lane, the load of the day or a shared company load: take it.
  const load = id('load');
  if (load) return [button('Поеми', `take:${load}`, STYLE.success, '🚚')];
  // The own truck stands after a breakdown: paid roadside assistance or call the colleagues.
  const stop = id('stop');
  if (stop && featureLive('roadside_paid', now, staff)) return [button(`Пътна помощ (${money(ROADSIDE.paidCents)})`, `road:pay:${stop}`, STYLE.primary, '🛠️'), button('Повикай колеги', `road:call:${stop}`, STYLE.secondary, '📣')];
  // A friend's or colleague's truck stands: help it.
  const help = id('help');
  if (help) return [button('Помогни', `road:help:${help}`, STYLE.success, '🤝')];
  // A duel invitation.
  const duel = id('duel');
  if (duel && featureLive('duels', now, staff)) return [button('Приеми дуела', `duel:yes:${duel}`, STYLE.success, '⚔️'), button('Откажи', `duel:no:${duel}`, STYLE.secondary)];
  return [];
}

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
      components: buttonRows(...(list.length === 1 ? actionButtons(last.href, isStaff(last.role), now) : []), linkButton('Отвори в играта', link(list.length === 1 ? last.href : null), '🎮')),
      embeds: [
        list.length === 1
          ? { title: last.title.slice(0, 250), description: last.body.slice(0, 1500), color: BRAND, footer: { text: 'TransVerse · известията в Discord се спират от Настройки' } }
          : { title: `${list.length} нови известия в TransVerse`, description: list.slice(-6).map((n) => `• **${n.title}** — ${n.body.slice(0, 120)}`).join('\n'), color: BRAND, footer: { text: 'TransVerse · известията в Discord се спират от Настройки' } },
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

/**
 * Worker: "пристига след ~5 мин" to linked players (deliveries on, quiet
 * hours respected), once per trip, with the loads waiting at the destination.
 */
export async function relayArrivingSoon(db: Database, now = new Date()) {
  if (!discordConfig().bot) return 0;
  const rows = await db
    .select({ id: deliveries.id, etaAt: deliveries.etaAt, discordId: users.discordId, prefs: users.discordPrefs, quiet: users.quietHours, role: users.role, plate: vehicles.plate, vehicleId: vehicles.id, destId: contracts.destCityId, dest: cities.nameBg })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .innerJoin(vehicles, eq(vehicles.id, deliveries.vehicleId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(and(eq(deliveries.status, 'in_progress'), isNotNull(users.discordId), gt(deliveries.etaAt, new Date(now.getTime() + 3 * 60_000)), lte(deliveries.etaAt, new Date(now.getTime() + 6 * 60_000))))
    .limit(200);
  let n = 0;
  for (const r of rows) {
    if (!featureLive('discord_bot', now, isStaff(r.role)) || !wantsDiscord(r.prefs, 'deliveries') || inQuietHours(r.quiet, now)) continue;
    await enqueue(db, `soon:${r.id}`, `dm:${r.discordId}`, {
      embeds: [{ title: `⏱️ ${r.plate} пристига в ${r.dest} <t:${Math.floor(r.etaAt!.getTime() / 1000)}:R>`, description: 'Виж товарите, които те чакат там — като пристигне, ще можеш да го пуснеш с „Нов курс за този камион“.', color: BRAND, footer: { text: 'TransVerse · известията в Discord се спират от Настройки' } }],
      components: buttonRows(linkButton(`Товари от ${r.dest}`, `${appUrl()}/game/contracts?from=${r.destId}&truck=${r.vehicleId}`, '📦')),
    }, now);
    n++;
  }
  return n;
}
