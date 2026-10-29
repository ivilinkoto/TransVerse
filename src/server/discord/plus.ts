import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { cities, companies, deliveries, discordOutbox, ideas, jobState, supportTickets, users, vehicles } from '@/server/db/schema';
import { featureLive } from '@/lib/game/features';
import { int } from '@/lib/format';
import { isStaff } from '@/server/auth/roles';
import { recentServerErrors } from '@/server/error-log';
import { replyToTicket, setTicketStatus } from '@/server/game/support';
import { jobHealth } from '@/server/game/world';
import { inQuietHours } from '@/server/push';
import { t, tx } from '@/i18n/t';
import { discord } from './api';
import { appUrl, BRAND, discordConfig } from './config';
import { announce, enqueue } from './outbox';
import { button, linkButton, rows, STYLE } from './ui';

/**
 * 1.1.3.4 „Discord+“ (`discord_plus`): the reminder about an idle truck, ✅
 * under a bug report closes its ticket, the team's daily report, the ideas'
 * weekly top 3.
 */

const HOUR = 3_600_000;
const plusOn = (now: Date) => !!discordConfig().bot && featureLive('discord_bot', now) && featureLive('discord_plus', now);
const sofiaHour = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(now));
const sofiaWeekday = (now: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Sofia', weekday: 'short' }).format(now);
const sofiaDate = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now);

// ── An idle truck (opt-in: Settings → Discord) ───────────────────────────

/** A truck counts as idle after this long without a trip (and is not nagged about after a day). */
export const IDLE_AFTER_MS = 2 * HOUR;
const IDLE_UNTIL_MS = 24 * HOUR;

/** Worker (hourly): one private message per idle truck and idle stretch, for those who asked for it. */
export async function idleTruckReminders(db: Database, now = new Date()) {
  if (!plusOn(now)) return 0;
  const lastTrip = sql<Date | null>`(select max(${deliveries.completedAt}) from ${deliveries} where ${deliveries.vehicleId} = ${vehicles.id} and ${deliveries.status} = 'completed')`;
  const trucks = await db
    .select({ userId: users.id, discordId: users.discordId, quiet: users.quietHours, seen: users.lastSeenAt, vehicleId: vehicles.id, plate: vehicles.plate, nickname: vehicles.nickname, bought: vehicles.purchasedAt, moving: vehicles.movingUntil, lastTrip, city: cities.nameBg })
    .from(users)
    .innerJoin(companies, eq(companies.ownerId, users.id))
    .innerJoin(vehicles, eq(vehicles.companyId, companies.id))
    .innerJoin(cities, eq(cities.id, vehicles.cityId))
    .where(and(isNotNull(users.discordId), isNull(users.bannedAt), sql`(${users.discordPrefs} ->> 'idle') = 'true'`, eq(vehicles.status, 'idle'), isNull(vehicles.soldAt), isNull(vehicles.testDriveFrom)));
  const told = new Set<string>();
  let sent = 0;
  for (const r of trucks) {
    if (told.has(r.userId) || !r.discordId || inQuietHours(r.quiet, now)) continue;
    // Not while the player is in the game.
    if (r.seen && now.getTime() - r.seen.getTime() < 30 * 60_000) continue;
    const since = Math.max(r.bought.getTime(), r.moving?.getTime() ?? 0, r.lastTrip ? new Date(r.lastTrip).getTime() : 0);
    const idle = now.getTime() - since;
    if (idle < IDLE_AFTER_MS || idle > IDLE_UNTIL_MS) continue;
    told.add(r.userId);
    await enqueue(db, `idle:${r.vehicleId}:${since}`, `dm:${r.discordId}`, {
      content: t('🅿️ **{0}** стои празен в {1} от {2} ч. Има товари, които чакат!', r.nickname ? tx(r.nickname) : r.plate, tx(r.city), Math.floor(idle / HOUR)),
      components: rows(button(t('Нов курс'), `course:truck:${r.vehicleId}`, STYLE.success, '🚚'), linkButton(t('Автопарк'), `${appUrl()}/game/fleet`)),
    }, now);
    sent++;
  }
  return sent;
}

// ── ✅ under a bug report ────────────────────────────────────────────────

/** The ticket a bug report from Discord became (see bugFromDiscord). */
export const bugTicketKey = (messageId: string) => `bug-ticket:${messageId}`;

/** The gateway: a linked member of the team puts ✅ under a bug report — the ticket is answered and closed. */
export async function bugReaction(db: Database, r: { user_id: string; channel_id: string; message_id: string; emoji?: { name?: string | null } }, now = new Date()) {
  if (r.emoji?.name !== '✅' || !plusOn(now)) return false;
  const [row] = await db.select().from(jobState).where(eq(jobState.key, bugTicketKey(r.message_id)));
  if (!row) return false;
  const [staff] = await db.select().from(users).where(and(eq(users.discordId, r.user_id), isNull(users.bannedAt)));
  if (!staff || !isStaff(staff.role)) return false;
  const { ticketId } = row.value as { ticketId: string };
  const [ticket] = await db.select({ status: supportTickets.status }).from(supportTickets).where(eq(supportTickets.id, ticketId));
  if (!ticket || ticket.status === 'closed') return false;
  const actor = { id: staff.id, role: staff.role, username: staff.username };
  await replyToTicket(db, actor, ticketId, t('Благодарим за сигнала — поправено е. (затворено от екипа в Discord)'));
  await setTicketStatus(db, actor, ticketId, 'closed');
  await discord('POST', `/channels/${r.channel_id}/messages`, { content: t('✅ Поправено — благодарим за сигнала!'), message_reference: { message_id: r.message_id, fail_if_not_exists: false }, allowed_mentions: { parse: [], replied_user: true } });
  return true;
}

// ── The team's daily report (#сигнали, 09:00) ────────────────────────────

/** The numbers of the last day for the team. */
export async function staffDailyNumbers(db: Database, now: Date) {
  const since = new Date(now.getTime() - 24 * HOUR);
  const [[players], [seen], [trips], [open], oldest, errors, health, [failed]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, since)),
    db.select({ n: sql<number>`count(*)::int` }).from(users).where(gte(users.lastSeenAt, since)),
    db.select({ n: sql<number>`count(*)::int` }).from(deliveries).where(and(eq(deliveries.status, 'completed'), gte(deliveries.completedAt, since))),
    db.select({ n: sql<number>`count(*)::int` }).from(supportTickets).where(eq(supportTickets.status, 'open')),
    db.select({ subject: supportTickets.subject, at: supportTickets.updatedAt }).from(supportTickets).where(eq(supportTickets.status, 'open')).orderBy(supportTickets.updatedAt).limit(1),
    recentServerErrors(db),
    jobHealth(db),
    db.select({ n: sql<number>`count(*)::int` }).from(discordOutbox).where(and(isNotNull(discordOutbox.lastError), gte(discordOutbox.createdAt, since))),
  ]);
  return {
    newPlayers: players?.n ?? 0,
    activePlayers: seen?.n ?? 0,
    trips: trips?.n ?? 0,
    openTickets: open?.n ?? 0,
    oldestTicket: oldest[0] ?? null,
    serverErrors: errors.filter((e) => new Date(e.at) >= since).length,
    failingJobs: health.filter((h) => (h.errorAt ?? 0) >= since.getTime() && (h.errorAt ?? 0) > (h.okAt ?? 0)).map((h) => h.key),
    discordFailures: failed?.n ?? 0,
  };
}

/** Worker: every morning from 09:00, once a day. */
export async function staffDailyReport(db: Database, now = new Date()) {
  if (!plusOn(now) || sofiaHour(now) < 9) return false;
  const n = await staffDailyNumbers(db, now);
  const ok = !n.serverErrors && !n.failingJobs.length && !n.discordFailures;
  await announce(db, `staff-daily:${sofiaDate(now)}`, 'staffAlerts', {
    ping: false,
    embeds: [{
      title: t('📋 Денят за екипа'),
      color: ok ? 0x2fd27a : 0xf6c343,
      url: `${appUrl()}/admin`,
      fields: [
        { name: t('Нови играчи'), value: int(n.newPlayers), inline: true },
        { name: t('Играли'), value: int(n.activePlayers), inline: true },
        { name: t('Курсове'), value: int(n.trips), inline: true },
        { name: t('Отворени запитвания'), value: n.oldestTicket ? t('{0} · най-старото: „{1}“ от <t:{2}:R>', n.openTickets, n.oldestTicket.subject, Math.floor(n.oldestTicket.at.getTime() / 1000)) : t('{0}', n.openTickets) },
        { name: t('Грешки на сървъра'), value: int(n.serverErrors), inline: true },
        { name: t('Неуспешни към Discord'), value: int(n.discordFailures), inline: true },
        { name: t('Задачи с грешка'), value: n.failingJobs.length ? n.failingJobs.join(', ') : t('няма') },
      ],
      footer: { text: t('Последните 24 часа · подробности в админ панела') },
    }],
  }, now);
  return true;
}

// ── The ideas' weekly top 3 (#идеи, Monday) ──────────────────────────────

/** Worker: on Monday from 10:00, the three most liked open ideas (once a week). */
export async function ideasWeeklyTop(db: Database, now = new Date()) {
  if (!plusOn(now) || !featureLive('ideas', now) || sofiaWeekday(now) !== 'Mon' || sofiaHour(now) < 10) return false;
  const top = await db.select({ id: ideas.id, title: ideas.title, votes: ideas.votes, discordVotes: ideas.discordVotes }).from(ideas).where(and(inArray(ideas.status, ['open', 'planned']), gt(ideas.votes, 0))).orderBy(desc(ideas.votes), ideas.createdAt).limit(3);
  if (!top.length) return false;
  await announce(db, `ideas-top:${sofiaDate(now)}`, 'ideas', () => ({
    ping: false,
    embeds: [{
      title: t('💡 Топ 3 идеи на седмицата'),
      url: `${appUrl()}/game/ideas`,
      color: BRAND,
      description: top.map((i, n) => t('{0} **{1}** · 👍 {2}{3}', ['🥇', '🥈', '🥉'][n], i.title, i.votes, i.discordVotes ? t(' (от Discord: {0})', i.discordVotes) : '')).join('\n'),
      footer: { text: t('Най-харесваните отворени идеи — екипът ги гледа първи') },
    }],
    components: rows(...top.map((i, n) => button(t('Гласувай за {0}', n + 1), `idea:vote:${i.id}`, STYLE.secondary, '👍'))),
  }), now);
  return true;
}

