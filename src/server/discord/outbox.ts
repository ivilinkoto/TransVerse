import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { discordOutbox, organizations, users } from '@/server/db/schema';
import { featureLive } from '@/lib/game/features';
import { inQuietHours } from '@/server/push';
import { discord, noPings, type DiscordMessage } from './api';
import { withLocale } from '@/i18n/als';
import { DISCORD_CHANNELS, discordConfig, LOCALE_CHANNELS, type DiscordChannel } from './config';
import { giveVerified, pingRoleFor, postIn } from './guild';
import { layoutChannel } from './layout';
import { ensureAllianceChannel, ensureCompanyChannel, removeAllianceChannel, stripRoles, syncUserRoles } from './sync';

/** Queues something for Discord once (the same dedupe key never twice). */
export async function enqueue(db: DbOrTx, dedupeKey: string, target: string, payload: Record<string, unknown>, now = new Date()) {
  // Without the bot's secrets nothing is queued (it would never be sent).
  if (!discordConfig().bot) return;
  await db.insert(discordOutbox).values({ dedupeKey: dedupeKey.slice(0, 200), target, payload, nextAttemptAt: now }).onConflictDoNothing();
}

/**
 * An announcement in one of the bot's channels. Built by a function, it is
 * written once per language: Bulgarian in the main channel, English and
 * Russian in their own channels (LOCALE_CHANNELS), when the channel has one.
 */
export async function announce(db: DbOrTx, dedupeKey: string, channel: DiscordChannel, message: DiscordMessage | (() => DiscordMessage), now = new Date()) {
  if (typeof message !== 'function') return enqueue(db, dedupeKey, `channel:${channel}`, message as Record<string, unknown>, now);
  await enqueue(db, dedupeKey, `channel:${channel}`, withLocale('bg', message) as Record<string, unknown>, now);
  for (const lang of ['en', 'ru'] as const) {
    if (LOCALE_CHANNELS[lang][channel]) await enqueue(db, `${dedupeKey}@${lang}`, `channel:${channel}@${lang}`, withLocale(lang, message) as Record<string, unknown>, now);
  }
}

export const MAX_ATTEMPTS = 6;

/** 1.1.3.5: private messages wait while the player's quiet hours (Settings → Известия) last. */
const QUIET_RETRY_MS = 30 * 60_000;
async function quietDms(db: Database, rows: { target: string }[], now: Date) {
  const ids = [...new Set(rows.filter((r) => r.target.startsWith('dm:')).map((r) => r.target.slice(3)))];
  if (!ids.length || !featureLive('discord_quiet', now)) return new Set<string>();
  const people = await db.select({ discordId: users.discordId, quiet: users.quietHours }).from(users).where(inArray(users.discordId, ids));
  return new Set(people.filter((p) => p.discordId && inQuietHours(p.quiet, now)).map((p) => `dm:${p.discordId}`));
}

async function send(db: Database, target: string, payload: Record<string, unknown>) {
  const [kind, id] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)];
  if (kind === 'channel') {
    const [key, lang] = id.split('@') as [DiscordChannel, 'en' | 'ru' | undefined];
    const name = (lang ? LOCALE_CHANNELS[lang]?.[key] : DISCORD_CHANNELS[key]) ?? key;
    const channelId = await layoutChannel(db, name);
    // No such channel in the server: nothing to send (the owner did not create it).
    if (!channelId) return;
    // Announcements mention the role of those who picked them in #роли (unless `ping: false`).
    const { ping, ...message } = payload as Record<string, unknown> & { ping?: boolean; content?: string };
    const role = ping === false ? null : await pingRoleFor(key);
    // 1.1.3.2: a forum channel gets a new post instead of a message.
    await postIn(channelId, role ? { ...message, content: `<@&${role}> ${message.content ?? ''}`.trim(), allowed_mentions: { parse: [], roles: [role] } } : { ...noPings, ...message });
  } else if (kind === 'msg') {
    // A message to a channel by id (tickets, polls): may allow its own mentions.
    await discord('POST', `/channels/${id}/messages`, { ...noPings, ...payload });
  } else if (kind === 'dm') {
    const dm = await discord<{ id: string }>('POST', '/users/@me/channels', { recipient_id: id });
    await discord('POST', `/channels/${dm.id}/messages`, { ...payload, ...noPings });
  } else if (kind === 'company') {
    // The company chat in its Discord channel, through the channel's webhook (name and picture of the author).
    const [org] = await db.select({ webhook: organizations.discordWebhook }).from(organizations).where(eq(organizations.id, id));
    if (!org?.webhook) return;
    await discord('POST', `/webhooks/${org.webhook}?wait=false`, { ...payload, ...noPings });
  } else if (target === 'job:roles') {
    await syncUserRoles(db, String(payload.userId));
  } else if (target === 'job:strip') {
    await stripRoles(String(payload.discordId));
  } else if (target === 'job:verified') {
    await giveVerified(String(payload.discordId));
  } else if (target === 'job:company-channel') {
    await ensureCompanyChannel(db, String(payload.organizationId));
  } else if (target === 'job:alliance-channel') {
    await ensureAllianceChannel(db, String(payload.allianceId));
  } else if (target === 'job:alliance-channel-remove') {
    await removeAllianceChannel((payload.channelId as string | null) ?? null, (payload.roleId as string | null) ?? null);
  }
}

/** Worker: sends what is due, in order; failures are retried with a growing pause, then given up. */
export async function processOutbox(db: Database, now = new Date(), limit = 25) {
  if (!discordConfig().bot) return 0;
  const due = await db.select().from(discordOutbox).where(and(isNull(discordOutbox.sentAt), lte(discordOutbox.nextAttemptAt, now))).orderBy(asc(discordOutbox.id)).limit(limit);
  const quiet = await quietDms(db, due, now);
  let sent = 0;
  for (const row of due) {
    if (quiet.has(row.target)) {
      await db.update(discordOutbox).set({ nextAttemptAt: new Date(now.getTime() + QUIET_RETRY_MS) }).where(eq(discordOutbox.id, row.id));
      continue;
    }
    try {
      await send(db, row.target, row.payload);
      await db.update(discordOutbox).set({ sentAt: new Date(), lastError: null }).where(eq(discordOutbox.id, row.id));
      sent++;
    } catch (error) {
      const attempts = row.attempts + 1;
      const message = (error as Error).message.slice(0, 500);
      console.warn('[discord] send failed', row.target, message);
      await db
        .update(discordOutbox)
        .set({ attempts, lastError: message, nextAttemptAt: new Date(now.getTime() + 2 ** attempts * 60_000), sentAt: attempts >= MAX_ATTEMPTS ? new Date() : null })
        .where(eq(discordOutbox.id, row.id));
    }
  }
  // Keep the table small: sent rows go after two weeks.
  await db.delete(discordOutbox).where(sql`${discordOutbox.sentAt} < ${new Date(now.getTime() - 14 * 86_400_000)}`);
  return sent;
}

/** 1.1.3.5, for the admin panel: what did not reach Discord (still retrying or given up), newest first. */
export async function failedOutbox(db: DbOrTx, limit = 30) {
  const rows = await db
    .select({ id: discordOutbox.id, target: discordOutbox.target, dedupeKey: discordOutbox.dedupeKey, attempts: discordOutbox.attempts, lastError: discordOutbox.lastError, createdAt: discordOutbox.createdAt, sentAt: discordOutbox.sentAt, nextAttemptAt: discordOutbox.nextAttemptAt })
    .from(discordOutbox)
    .where(isNotNull(discordOutbox.lastError))
    .orderBy(desc(discordOutbox.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, gaveUp: !!r.sentAt }));
}

/** "Прати пак": the message goes again on the worker's next round, with fresh attempts. */
export async function retryOutbox(db: DbOrTx, id: number, now = new Date()) {
  const [row] = await db.update(discordOutbox).set({ attempts: 0, sentAt: null, lastError: null, nextAttemptAt: now }).where(and(eq(discordOutbox.id, id), isNotNull(discordOutbox.lastError))).returning({ id: discordOutbox.id });
  return !!row;
}

/** The bot gives or takes this player's roles soon (when the bot is set up). */
export async function queueRoles(db: DbOrTx, userId: string, now = new Date()) {
  if (!discordConfig().bot) return;
  await enqueue(db, `roles:${userId}:${now.getTime()}`, 'job:roles', { userId }, now);
}
