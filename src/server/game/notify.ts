import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { activity, notifications, users } from '@/server/db/schema';
import { resolveText, type LocalText } from '@/i18n/als';

export type NotificationKind = 'success' | 'info' | 'warning' | 'achievement';

/** The player's language (v2.0) — the text they receive is written in it. */
export async function localeOf(db: DbOrTx, userId: string) {
  const [u] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId));
  return u?.locale ?? 'bg';
}

/**
 * Stores a notification and wakes up connected clients (delivered after commit by Postgres).
 * Title and body may be functions: they are written in the recipient's language.
 * `sound: 'arrival'` (1.1.3) asks an open game for the arrival sound instead of the usual chime.
 */
export async function notify(db: DbOrTx, userId: string, kind: NotificationKind, title: LocalText, body: LocalText, href?: string, opts?: { sound?: 'arrival' }) {
  const locale = typeof title === 'function' || typeof body === 'function' ? await localeOf(db, userId) : null;
  await db.insert(notifications).values({ userId, kind, title: resolveText(title, locale), body: resolveText(body, locale), href });
  await db.execute(sql`select pg_notify('tv_events', ${JSON.stringify({ userId, type: 'notification', ...(opts?.sound ? { sound: opts.sound } : {}) })})`);
}

/** Broadcast that shared world data changed (e.g. the freight market). */
export async function broadcast(db: DbOrTx, type: 'market' | 'leaderboard' | 'world') {
  await db.execute(sql`select pg_notify('tv_events', ${JSON.stringify({ type })})`);
}

export async function logActivity(db: DbOrTx, userId: string, action: string, details: Record<string, unknown> = {}) {
  await db.insert(activity).values({ userId, action, details });
}

export async function markNotificationsRead(db: DbOrTx, userId: string) {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}
