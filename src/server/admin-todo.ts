/**
 * 1.2.3.1 „Сега за правене“: what waits for the staff, on top of the admin
 * dashboard — each line with its count and the page to go to. Support staff
 * see only their part (tickets and reports).
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { payments, supportTickets } from '@/server/db/schema';
import { readiness } from '@/server/admin-1142';
import { countryHealth } from '@/server/game/game-health';
import { openReportCount } from '@/server/game/moderation';
import { newPartnerInquiries } from '@/server/partners';

export interface TodoItem { id: 'tickets' | 'reports' | 'payments' | 'starved' | 'release' | 'partners'; count: number; href: string; tone: 'red' | 'orange' | 'cyan'; version?: string; hours?: number }

export async function adminTodo(db: DbOrTx, now: Date, admin: boolean): Promise<TodoItem[]> {
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const [[tickets], reports] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(supportTickets).where(eq(supportTickets.status, 'open')),
    openReportCount(db),
  ]);
  const items: TodoItem[] = [
    { id: 'tickets', count: tickets?.n ?? 0, href: '/admin/tickets', tone: 'orange' },
    { id: 'reports', count: reports, href: '/admin/reports', tone: 'red' },
  ];
  if (admin) {
    const [[failed], countries, ready, partners] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(payments).where(and(eq(payments.status, 'failed'), gte(payments.createdAt, week))),
      countryHealth(db, now),
      readiness(db, now).catch(() => null),
      newPartnerInquiries(db),
    ]);
    items.push({ id: 'partners', count: partners, href: '/admin/partners', tone: 'cyan' });
    items.push({ id: 'payments', count: failed?.n ?? 0, href: '/admin/payments', tone: 'red' });
    items.push({ id: 'starved', count: countries.filter((c) => c.starved).length, href: '/admin/health', tone: 'orange' });
    // An update that comes out within 3 days with something missing.
    if (ready && ready.hoursLeft <= 72) {
      const gaps = (ready.missing.en > 0 ? 1 : 0) + (ready.missing.ru > 0 ? 1 : 0) + (ready.notes > 0 ? 0 : 1) + ready.features.filter((f) => f.off).length;
      items.push({ id: 'release', count: gaps, href: '/admin/readiness', tone: 'cyan', version: ready.release.version, hours: ready.hoursLeft });
    }
  }
  return items.filter((i) => i.count > 0);
}
