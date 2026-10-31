import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { deliveries, ledgerEntries, notifications, vehicles } from '@/server/db/schema';

/** 1.1.4.1 „Докато те нямаше“: shown when the player comes back after this long. */
export const WELCOME_BACK_AFTER_MS = 6 * 3_600_000;

export interface WelcomeBack {
  since: string;
  hours: number;
  trips: number;
  earnedCents: number;
  netCents: number;
  unread: number;
  idleTrucks: number;
}

/** What happened while the player was away (game data); null when they were here recently. */
export async function welcomeBack(db: DbOrTx, companyId: string, userId: string, lastSeenAt: Date | null, now: Date): Promise<WelcomeBack | null> {
  if (!lastSeenAt || now.getTime() - lastSeenAt.getTime() < WELCOME_BACK_AFTER_MS) return null;
  const since = lastSeenAt;
  const [[trips], [net], [unread], [idle]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${deliveries.payoutCents}), 0)::bigint` }).from(deliveries).where(and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, since))),
    db.select({ cents: sql<number>`coalesce(sum(${ledgerEntries.amountCents}), 0)::bigint` }).from(ledgerEntries).where(and(eq(ledgerEntries.companyId, companyId), gte(ledgerEntries.createdAt, since))),
    db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt), gte(notifications.createdAt, since))),
    db.select({ n: sql<number>`count(*)::int` }).from(vehicles).where(and(eq(vehicles.companyId, companyId), eq(vehicles.status, 'idle'), isNull(vehicles.soldAt))),
  ]);
  const summary = { trips: trips?.n ?? 0, earnedCents: Number(trips?.cents ?? 0), netCents: Number(net?.cents ?? 0), unread: unread?.n ?? 0, idleTrucks: idle?.n ?? 0 };
  // Nothing at all happened: no window, just the game.
  if (!summary.trips && !summary.unread && !summary.netCents) return null;
  return { since: since.toISOString(), hours: Math.floor((now.getTime() - since.getTime()) / 3_600_000), ...summary };
}
