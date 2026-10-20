/**
 * Web Push: notifications on the player's phone or computer even when the
 * game is closed. The browser keeps a subscription; the worker sends every new
 * in-game notification (and company chat messages) to it, filtered by the
 * player's choices. Keys (VAPID) come from the environment or are generated
 * once and kept in the database.
 */
import { and, eq, gt, inArray, lt, lte, sql } from 'drizzle-orm';
import webpush from 'web-push';
import { z } from 'zod';
import { featureLive } from '@/lib/game/features';
import { isStaff } from '@/server/auth/roles';
import type { Database, DbOrTx } from '@/server/db/client';
import { companyMembers, companyMessages, jobState, notifications, organizations, pushSubscriptions, users } from '@/server/db/schema';

// ── Categories ────────────────────────────────────────────────────────────

export const PUSH_CATEGORIES = {
  deliveries: 'Доставки и автопарк (пристигнал камион, закъснение, откупуване)',
  urgent: 'Спешни доставки',
  events: 'Ивенти и мисии',
  company: 'Компания (членове, касата, фирмени мисии)',
  chat: 'Чат на компанията и лични съобщения',
  favorites: 'Нови поръчки по любимите ми линии',
  clients: 'Договори с клиенти',
  fines: 'Глоби',
  news: 'Седмичник (нов брой)',
  holiday: 'Празници (Хелуин, призрачният камион)',
  general: 'Всичко останало (ниво, постижения, поддръжка, плащания)',
} as const;
export type PushCategory = keyof typeof PUSH_CATEGORIES;
export const PUSH_CATEGORY_IDS = Object.keys(PUSH_CATEGORIES) as PushCategory[];

/** Which category an in-game notification belongs to (by the page it links to). */
export function categoryOf(href: string | null | undefined): PushCategory {
  if (!href) return 'general';
  if (href.startsWith('/game/contracts?fav=1')) return 'favorites';
  // "Delivered" links to the return loads from the destination.
  if (href.startsWith('/game/contracts?from=')) return 'deliveries';
  if (href.startsWith('/game/contracts')) return 'urgent';
  if (href.startsWith('/game/finance#fines')) return 'fines';
  if (href.startsWith('/game/clients')) return 'clients';
  if (href.startsWith('/game/news')) return 'news';
  if (href.startsWith('/game/halloween') || href.startsWith('/game/christmas')) return 'holiday';
  // Private messages and @mentions open the chat.
  if (href.includes('?chat=')) return 'chat';
  if (href.startsWith('/game/finance') || href.startsWith('/game/fleet') || href.startsWith('/game/garage')) return 'deliveries';
  if (href.startsWith('/game/events') || href.startsWith('/game/missions')) return 'events';
  if (href.startsWith('/game/company/chat')) return 'chat';
  if (href.startsWith('/game/company')) return 'company';
  return 'general';
}

/** From v1.3 the notifications outside the game go to Discord only (see discord/relay.ts), not to phones. */
export const viaDiscord = (role: string, now: Date) => featureLive('discord_bot', now, isStaff(role));

export const wants = (prefs: Partial<Record<string, boolean>> | null | undefined, category: PushCategory) => prefs?.[category] !== false;

/** Quiet hours (Sofia time): no phone notifications from `from` to `to` (may cross midnight). */
export function inQuietHours(q: { from: number; to: number } | null | undefined, now: Date): boolean {
  if (!q || q.from === q.to) return false;
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(now));
  return q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
}

export const quietHoursSchema = z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(23) }).nullable();

export async function setQuietHours(db: DbOrTx, userId: string, q: z.infer<typeof quietHoursSchema>) {
  await db.update(users).set({ quietHours: q && q.from !== q.to ? q : null }).where(eq(users.id, userId));
}

// ── Keys ──────────────────────────────────────────────────────────────────

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cachedKeys: VapidKeys | null = null;

/** VAPID keys: from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, else generated once and stored. */
export async function vapidKeys(db: DbOrTx): Promise<VapidKeys> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  if (cachedKeys) return cachedKeys;
  const [row] = await db.select().from(jobState).where(eq(jobState.key, 'vapid'));
  if (row) return (cachedKeys = row.value as VapidKeys);
  const fresh = webpush.generateVAPIDKeys();
  await db.insert(jobState).values({ key: 'vapid', value: fresh }).onConflictDoNothing();
  // Another process may have won the race — read back what is stored.
  const [stored] = await db.select().from(jobState).where(eq(jobState.key, 'vapid'));
  return (cachedKeys = stored!.value as VapidKeys);
}

// ── Subscriptions ─────────────────────────────────────────────────────────

export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'Невалиден адрес за известия.'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

const MAX_DEVICES = 10;

/** Saves (or moves to this player) a browser's subscription. */
export async function subscribe(db: Database, userId: string, raw: z.input<typeof subscriptionSchema>, userAgent?: string | null) {
  const sub = subscriptionSchema.parse(raw);
  await db.transaction(async (tx) => {
    await tx
      .insert(pushSubscriptions)
      .values({ userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null } });
    // Keep the newest devices only.
    const all = await tx.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).orderBy(sql`${pushSubscriptions.createdAt} desc`);
    const extra = all.slice(MAX_DEVICES).map((r) => r.id);
    if (extra.length) await tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, extra));
  });
}

export async function unsubscribe(db: Database, userId: string, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export const prefsSchema = z.object(Object.fromEntries(PUSH_CATEGORY_IDS.map((c) => [c, z.boolean()])) as Record<PushCategory, z.ZodBoolean>).partial();

export async function setPushPrefs(db: Database, userId: string, raw: z.input<typeof prefsSchema>) {
  const prefs = prefsSchema.parse(raw);
  const [u] = await db.select({ prefs: users.pushPrefs }).from(users).where(eq(users.id, userId));
  await db.update(users).set({ pushPrefs: { ...(u?.prefs ?? {}), ...prefs } }).where(eq(users.id, userId));
}

export async function deviceCount(db: DbOrTx, userId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  return r?.n ?? 0;
}

// ── Sending ───────────────────────────────────────────────────────────────

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Same tag replaces an older notification on the device. */
  tag?: string;
  /** Buttons on the notification (phones show up to two). */
  actions?: PushAction[];
}

export interface PushAction {
  action: string;
  title: string;
  url: string;
}

/** Quick buttons for a notification, by the page it links to. */
export function pushActionsFor(href: string | null | undefined): PushAction[] | undefined {
  if (!href) return undefined;
  // A delivery arrived: take a load back from there, or look at the whole board.
  if (href.startsWith('/game/contracts?from=')) return [{ action: 'back', title: 'Обратен товар', url: href }, { action: 'board', title: 'Нов курс', url: '/game/contracts' }];
  if (href.includes('?chat=')) return [{ action: 'chat', title: 'Отвори чата', url: href }];
  return undefined;
}

type Sub = typeof pushSubscriptions.$inferSelect;
/** Sends one payload; returns the HTTP status (a fake can be passed in tests). */
export type PushSender = (sub: Sub, payload: string, keys: VapidKeys) => Promise<number>;

export const webPushSender: PushSender = async (sub, payload, keys) => {
  const res = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
    vapidDetails: { subject: process.env.VAPID_SUBJECT || `mailto:${process.env.SUPPORT_EMAIL || 'support@transverse-bg.com'}`, publicKey: keys.publicKey, privateKey: keys.privateKey },
    TTL: 6 * 3600,
    // High urgency: otherwise Android delivers the message only when the sleeping phone wakes up.
    urgency: 'high',
    timeout: 10_000,
  });
  return res.statusCode;
};

/** Sends a message to every device of a player. Devices that are gone (404/410) are forgotten. */
export async function pushToUser(db: Database, userId: string, message: PushMessage, sender: PushSender = webPushSender): Promise<number> {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (!subs.length) return 0;
  const keys = await vapidKeys(db);
  const payload = JSON.stringify({ ...message, title: message.title.slice(0, 120), body: message.body.slice(0, 300) });
  let sent = 0;
  for (const sub of subs) {
    try {
      const status = await sender(sub, payload, keys);
      if (status >= 200 && status < 300) {
        sent++;
        await db.update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
      }
    } catch (error) {
      const e = error as { statusCode?: number; body?: string; message?: string };
      if (e.statusCode === 404 || e.statusCode === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      else {
        const text = `${e.statusCode ?? ''} ${e.body || e.message || 'грешка'}`.trim().slice(0, 500);
        console.warn('[push] send failed', text);
        await db.update(pushSubscriptions).set({ lastErrorAt: new Date(), lastError: text }).where(eq(pushSubscriptions.id, sub.id));
      }
    }
  }
  return sent;
}

async function cursor(db: Database, key: string, current: () => Promise<number>): Promise<number> {
  const [row] = await db.select().from(jobState).where(eq(jobState.key, key));
  if (row) return Number((row.value as { id: number }).id);
  // First run: start from now (old notifications are never pushed).
  const id = await current();
  await saveCursor(db, key, id);
  return id;
}
const saveCursor = (db: Database, key: string, id: number) => db.insert(jobState).values({ key, value: { id } }).onConflictDoUpdate({ target: jobState.key, set: { value: { id }, updatedAt: new Date() } });

/** Players who were active in the game this recently are not pushed chat messages (they see them live). */
const CHAT_QUIET_MS = 2 * 60_000;

/**
 * Worker: pushes the notifications created since the last run (in-game ones and
 * company chat messages) to the players who subscribed and want that category.
 * Many at once for one player become a single summary.
 */
export async function dispatchPush(db: Database, now = new Date(), sender: PushSender = webPushSender) {
  let pushed = 0;
  // In-game notifications.
  const from = await cursor(db, 'push-cursor', async () => Number((await db.execute<{ m: number }>(sql`select coalesce(max(id), 0)::bigint as m from notifications`)).rows[0]?.m ?? 0));
  // Up to the newest id right now, so nothing inserted meanwhile is skipped.
  const upTo = Number((await db.execute<{ m: number }>(sql`select coalesce(max(id), 0)::bigint as m from notifications`)).rows[0]?.m ?? from);
  const rows = await db
    .select({ id: notifications.id, userId: notifications.userId, title: notifications.title, body: notifications.body, href: notifications.href, prefs: users.pushPrefs, quiet: users.quietHours, role: users.role })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(gt(notifications.id, from), lte(notifications.id, upTo), sql`exists (select 1 from push_subscriptions s where s.user_id = ${notifications.userId})`))
    .orderBy(notifications.id)
    .limit(1000);
  const byUser = new Map<string, typeof rows>();
  // Quiet hours: nothing reaches the phone (the notifications stay in the game).
  for (const r of rows) if (!viaDiscord(r.role, now) && wants(r.prefs, categoryOf(r.href)) && !inQuietHours(r.quiet, now)) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  for (const [userId, list] of byUser) {
    const message: PushMessage =
      list.length === 1
        ? { title: list[0]!.title, body: list[0]!.body, url: list[0]!.href ?? '/game/notifications', tag: `n${list[0]!.id}`, actions: featureLive('push_actions', now, isStaff(list[0]!.role)) ? pushActionsFor(list[0]!.href) : undefined }
        : { title: `${list.length} нови известия в TransVerse`, body: list.slice(-3).map((n) => n.title).join(' · '), url: '/game/notifications', tag: 'summary' };
    pushed += await pushToUser(db, userId, message, sender);
  }
  // When there were more than the batch, continue from the last one handled.
  await saveCursor(db, 'push-cursor', rows.length === 1000 ? rows.at(-1)!.id : Math.max(from, upTo));

  // Company chat.
  const chatFrom = await cursor(db, 'push-chat-cursor', async () => Number((await db.execute<{ m: number }>(sql`select coalesce(max(id), 0)::bigint as m from company_messages`)).rows[0]?.m ?? 0));
  const messages = await db
    .select({ id: companyMessages.id, companyId: companyMessages.companyId, authorId: companyMessages.userId, body: companyMessages.body, author: users.username, company: organizations.name })
    .from(companyMessages)
    .innerJoin(users, eq(users.id, companyMessages.userId))
    .innerJoin(organizations, eq(organizations.id, companyMessages.companyId))
    .where(gt(companyMessages.id, chatFrom))
    .orderBy(companyMessages.id)
    .limit(500);
  if (messages.length) {
    const companies = [...new Set(messages.map((m) => m.companyId))];
    const members = await db
      .select({ userId: companyMembers.userId, companyId: companyMembers.companyId, prefs: users.pushPrefs, quiet: users.quietHours, role: users.role })
      .from(companyMembers)
      .innerJoin(users, eq(users.id, companyMembers.userId))
      .where(
        and(
          inArray(companyMembers.companyId, companies),
          sql`exists (select 1 from push_subscriptions s where s.user_id = ${companyMembers.userId})`,
          sql`(${users.lastSeenAt} is null or ${users.lastSeenAt} < ${new Date(now.getTime() - CHAT_QUIET_MS)})`,
        ),
      );
    for (const m of members) {
      if (viaDiscord(m.role, now) || !wants(m.prefs, 'chat') || inQuietHours(m.quiet, now)) continue;
      const mine = messages.filter((x) => x.companyId === m.companyId && x.authorId !== m.userId);
      if (!mine.length) continue;
      const last = mine.at(-1)!;
      const message: PushMessage =
        mine.length === 1
          ? { title: `${last.author} · ${last.company}`, body: last.body, url: '/game/company/chat', tag: 'chat' }
          : { title: `${mine.length} нови съобщения · ${last.company}`, body: `${last.author}: ${last.body}`, url: '/game/company/chat', tag: 'chat' };
      pushed += await pushToUser(db, m.userId, message, sender);
    }
    await saveCursor(db, 'push-chat-cursor', messages.at(-1)!.id);
  }
  return pushed;
}

/** Forgets devices that have not worked for a long time. */
export async function pruneSubscriptions(db: Database, now = new Date()) {
  await db.delete(pushSubscriptions).where(and(lt(pushSubscriptions.createdAt, new Date(now.getTime() - 120 * 86_400_000)), sql`coalesce(${pushSubscriptions.lastSuccessAt}, ${pushSubscriptions.createdAt}) < ${new Date(now.getTime() - 60 * 86_400_000)}`));
}


/** Admin diagnostics: every device with its last success and last error (newest first). */
export async function pushDevices(db: DbOrTx, limit = 200) {
  return db
    .select({ id: pushSubscriptions.id, username: users.username, userAgent: pushSubscriptions.userAgent, createdAt: pushSubscriptions.createdAt, lastSuccessAt: pushSubscriptions.lastSuccessAt, lastErrorAt: pushSubscriptions.lastErrorAt, lastError: pushSubscriptions.lastError, prefs: users.pushPrefs, quiet: users.quietHours })
    .from(pushSubscriptions)
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
    .orderBy(sql`coalesce(${pushSubscriptions.lastErrorAt}, ${pushSubscriptions.createdAt}) desc`)
    .limit(limit);
}
