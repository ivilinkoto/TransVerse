/**
 * 1.4 „Градски куриер“ on the server: replays the taps on the real street graph, keeps the
 * day's runs per player in job_state (`courier:<day>:<user>` = { runs, awarded }) and gives
 * XP for the best run's stars — only the part above what the day already gave.
 */
import { desc, eq, inArray, like } from 'drizzle-orm';
import { COURIER, courierDay, replayCourier } from '@/lib/game/courier';
import { courierCity, type StreetGraph } from '@/lib/game/courier-graph';
import { dayKey } from '@/lib/game/daily';
import sofia from '@/lib/game/streets/sofia.json';
import plovdiv from '@/lib/game/streets/plovdiv.json';
import varna from '@/lib/game/streets/varna.json';
import type { Database, DbOrTx } from '@/server/db/client';
import { jobState, users } from '@/server/db/schema';
import { fail } from './errors';
import { awardXp } from './progression';
import { t } from '@/i18n/t';

const GRAPHS: Record<string, StreetGraph> = { sofia: sofia as StreetGraph, plovdiv: plovdiv as StreetGraph, varna: varna as StreetGraph };
export const courierGraph = (city: string) => GRAPHS[city];

interface Run { city: string; delivered: number; timeS: number; points: number; stars: number; at: string }
interface Day { runs: Run[]; awarded: number }

const runKey = (day: string, userId: string) => `courier:${day}:${userId}`;

export async function playCourier(db: Database, userId: string, city: string, taps: number[], now: Date) {
  const g = GRAPHS[city];
  if (!g || !courierCity(city)) fail('no_city', t('Няма такъв град.'));
  if (taps.length > COURIER.maxTaps) fail('too_long', t('Твърде много спирки.'));
  const day = dayKey(now);
  const result = replayCourier(g!, courierDay(g!, day), taps);
  return db.transaction(async (tx) => {
    const key = runKey(day, userId);
    await tx.insert(jobState).values({ key, value: { runs: [], awarded: 0 } }).onConflictDoNothing();
    const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key)).for('update');
    const st = row!.value as Day;
    if (st.runs.length >= COURIER.runsPerDay) fail('no_runs', t('Днес смените свършиха — нови пратки утре.'));
    const runs = [...st.runs, { city, delivered: result.delivered.length, timeS: result.timeS, points: result.points, stars: result.stars, at: now.toISOString() }];
    const best = Math.max(...runs.map((r) => r.stars));
    const xp = (COURIER.xp[best] ?? 0) - (COURIER.xp[st.awarded] ?? 0);
    if (xp > 0) await awardXp(tx, userId, xp, 'city_courier');
    await tx.update(jobState).set({ value: { runs, awarded: Math.max(best, st.awarded) }, updatedAt: now }).where(eq(jobState.key, key));
    return { delivered: result.delivered.length, timeS: result.timeS, points: result.points, stars: result.stars, xp: Math.max(0, xp), runsLeft: COURIER.runsPerDay - runs.length };
  });
}

export async function courierView(db: DbOrTx, userId: string, now: Date) {
  const day = dayKey(now);
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, runKey(day, userId)));
  const st = (row?.value as Day | undefined) ?? { runs: [], awarded: 0 };
  return { day, runs: st.runs, runsLeft: COURIER.runsPerDay - st.runs.length };
}

/** Today's best rounds in a city (points, then the earlier one). */
export async function courierRanking(db: DbOrTx, city: string, now: Date, limit = 10) {
  const day = dayKey(now);
  const prefix = `courier:${day}:`;
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, `${prefix}%`)).orderBy(desc(jobState.updatedAt)).limit(2000);
  const top = rows
    .map((r) => ({ userId: r.key.slice(prefix.length), best: (r.value as Day).runs.filter((x) => x.city === city).reduce<Run | null>((b, x) => (!b || x.points > b.points ? x : b), null) }))
    .filter((x): x is { userId: string; best: Run } => !!x.best)
    .sort((a, b) => b.best.points - a.best.points || a.best.at.localeCompare(b.best.at))
    .slice(0, limit);
  if (!top.length) return [];
  const names = new Map((await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, top.map((x) => x.userId)))).map((u) => [u.id, u.username]));
  return top.map((x) => ({ userId: x.userId, username: names.get(x.userId) ?? '—', points: x.best.points, delivered: x.best.delivered, stars: x.best.stars }));
}
