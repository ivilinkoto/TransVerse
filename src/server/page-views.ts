import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { pageViews, pageVisitors } from '@/server/db/schema';
import { periodWindow } from '@/lib/game/missions';
import { normalizePagePath } from '@/lib/game/page-path';
import { ACCOUNT_MENU, SECTIONS } from '@/components/game/nav';

/** 1.2.1.1: page visits are kept this many days (counts per day stay). */
export const PAGE_VISITORS_DAYS = 90;

const dayKey = (d: Date) => periodWindow('daily', d).key.slice(1);

/** One page open by a player (staff are not counted). */
export async function recordPageView(db: Database, userId: string, raw: string, now = new Date()) {
  const path = normalizePagePath(raw);
  if (!path) return false;
  const day = dayKey(now);
  await db.insert(pageViews).values({ day, path, views: 1 }).onConflictDoUpdate({ target: [pageViews.day, pageViews.path], set: { views: sql`${pageViews.views} + 1` } });
  await db.insert(pageVisitors).values({ day, path, userId }).onConflictDoNothing();
  return true;
}

/** Every page the menus link to, with the section it is in. */
export function knownPages(): { path: string; label: string; section: string }[] {
  const tabs = SECTIONS.flatMap((s) => (s.tabs?.length ? s.tabs.map((t) => ({ path: t.href, label: t.label, section: s.label })) : [{ path: s.href, label: s.label, section: s.label }]));
  const account = ACCOUNT_MENU.map((a) => ({ path: a.href, label: a.label, section: 'Профил' }));
  const seen = new Set<string>();
  return [...tabs, ...account].filter((p) => (seen.has(p.path) ? false : (seen.add(p.path), true)));
}

/** Views and different players per page for the last `days` days, the busiest first, and the menu pages nobody opened. */
export async function pageStats(db: DbOrTx, days: number, now = new Date()) {
  const from = dayKey(new Date(now.getTime() - (days - 1) * 86_400_000));
  const views = await db.select({ path: pageViews.path, views: sql<number>`sum(${pageViews.views})::int` }).from(pageViews).where(gte(pageViews.day, from)).groupBy(pageViews.path);
  const people = await db.select({ path: pageVisitors.path, players: sql<number>`count(distinct ${pageVisitors.userId})::int` }).from(pageVisitors).where(gte(pageVisitors.day, from)).groupBy(pageVisitors.path);
  const [{ total = 0 } = {}] = await db.select({ total: sql<number>`count(distinct ${pageVisitors.userId})::int` }).from(pageVisitors).where(gte(pageVisitors.day, from));
  const byPath = new Map(people.map((p) => [p.path, p.players]));
  const known = knownPages();
  const label = new Map(known.map((k) => [k.path, k]));
  const rows = views
    .map((v) => ({ path: v.path, views: v.views, players: byPath.get(v.path) ?? 0, label: label.get(v.path)?.label ?? null, section: label.get(v.path)?.section ?? null }))
    .sort((a, b) => b.players - a.players || b.views - a.views);
  const opened = new Set(rows.map((r) => r.path));
  return { from, total, rows, unopened: known.filter((k) => !opened.has(k.path)) };
}

/** Worker: forget who opened what after 90 days (the daily counts stay). */
export async function prunePageVisitors(db: Database, now = new Date()) {
  const cut = dayKey(new Date(now.getTime() - PAGE_VISITORS_DAYS * 86_400_000));
  const gone = await db.delete(pageVisitors).where(lt(pageVisitors.day, cut)).returning({ day: pageVisitors.day });
  return gone.length;
}

/** The days a page was opened (for one page's trend). */
export async function pageTrend(db: DbOrTx, path: string, days: number, now = new Date()) {
  const from = dayKey(new Date(now.getTime() - (days - 1) * 86_400_000));
  return db.select({ day: pageViews.day, views: pageViews.views }).from(pageViews).where(and(eq(pageViews.path, path), gte(pageViews.day, from))).orderBy(pageViews.day);
}
