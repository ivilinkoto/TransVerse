/**
 * Which pages players open — for deciding what to keep in the game (Админ → Използване).
 * One count per player, page and day (no times, no order), the staff not counted. The web
 * process keeps the day's visits in memory and adds them to `page-visits:<day>` once a
 * minute, so a page view costs no write of its own.
 */
import { eq, like } from 'drizzle-orm';
import { ACCOUNT_MENU, SECTIONS } from '@/components/game/nav';
import { dayKey } from '@/lib/game/daily';
import type { DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';

/** Every page of the menu (its href), longest first, so /game/inventory/album wins over /game/inventory. */
const PAGES = [...new Set([...SECTIONS.flatMap((s) => [s.href, ...(s.tabs ?? []).map((t) => t.href)]), ...ACCOUNT_MENU.map((m) => m.href), '/game/play', '/game/rewards', '/game/compete'])].sort((a, b) => b.length - a.length);

/** The menu page a path belongs to (/game/fleet/123 → /game/fleet), or null outside the menu. */
export function pageOf(path: string): string | null {
  const p = path.split(/[?#]/)[0]!.replace(/\/+$/, '') || '/';
  if (p === '/game') return '/game';
  return PAGES.find((h) => h !== '/game' && (p === h || p.startsWith(h + '/'))) ?? null;
}

const g = globalThis as unknown as { tvVisits?: Map<string, Map<string, Set<string>>>; tvVisitTimer?: ReturnType<typeof setInterval> };
const buffer = () => (g.tvVisits ??= new Map());

/** Notes a visit (in memory). */
export function noteVisit(userId: string, path: string, now = new Date()) {
  const page = pageOf(path);
  if (!page) return;
  const day = dayKey(now);
  const pages = buffer().get(day) ?? new Map<string, Set<string>>();
  buffer().set(day, pages);
  const users = pages.get(page) ?? new Set<string>();
  users.add(userId);
  pages.set(page, users);
}

/** Adds the noted visits to the database (and forgets them). */
export async function flushVisits(db: DbOrTx) {
  const days = [...buffer()];
  buffer().clear();
  for (const [day, pages] of days) {
    await db.transaction(async (tx) => {
      const key = `page-visits:${day}`;
      await tx.insert(jobState).values({ key, value: {} }).onConflictDoNothing();
      const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key)).for('update');
      const value = { ...((row?.value as Record<string, string[]>) ?? {}) };
      for (const [page, users] of pages) value[page] = [...new Set([...(value[page] ?? []), ...users])];
      await tx.update(jobState).set({ value, updatedAt: new Date() }).where(eq(jobState.key, key));
    });
  }
}

/** Starts the minute flush in this process (once). */
export function startVisitFlush(db: () => DbOrTx) {
  if (g.tvVisitTimer) return;
  g.tvVisitTimer = setInterval(() => void flushVisits(db()).catch(() => {}), 60_000);
  g.tvVisitTimer.unref();
}

/** Players per page over the last `days` days (each player once per page), and since when it is counted. */
export async function pageUsage(db: DbOrTx, now: Date, days = 30) {
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, 'page-visits:%'));
  const from = dayKey(new Date(now.getTime() - (days - 1) * 86_400_000));
  const per = new Map<string, Set<string>>();
  let first: string | null = null;
  for (const r of rows) {
    const day = r.key.slice('page-visits:'.length);
    if (day < from) continue;
    if (!first || day < first) first = day;
    for (const [page, users] of Object.entries(r.value as Record<string, string[]>)) {
      const set = per.get(page) ?? new Set<string>();
      for (const u of users) set.add(u);
      per.set(page, set);
    }
  }
  return { since: first, pages: [...per].map(([page, users]) => ({ page, players: users.size })).sort((a, b) => b.players - a.players) };
}
