/**
 * 1.3 „Нощен рейс“ on the server: replays the run, keeps the day's runs per player in
 * job_state (`night-run:<day>:<user>` = { runs, awarded }) and gives XP for the best
 * run's stars — only the part above what the day already gave.
 */
import { desc, eq, inArray, like } from 'drizzle-orm';
import { dayKey } from '@/lib/game/daily';
import { NIGHT_RUN, replayRun } from '@/lib/game/night-run';
import type { Database, DbOrTx } from '@/server/db/client';
import { jobState, users } from '@/server/db/schema';
import { fail } from './errors';
import { awardXp } from './progression';
import { t } from '@/i18n/t';

interface Run { metres: number; stars: number; crashes: number; cans: number; at: string }
interface Day { runs: Run[]; awarded: number }

const runKey = (day: string, userId: string) => `night-run:${day}:${userId}`;

export async function playNightRun(db: Database, userId: string, inputs: number[], now: Date) {
  if (inputs.length > NIGHT_RUN.maxTicks) fail('too_long', t('Твърде дълъг рейс.'));
  const day = dayKey(now);
  const result = replayRun(day, inputs);
  return db.transaction(async (tx) => {
    const key = runKey(day, userId);
    await tx.insert(jobState).values({ key, value: { runs: [], awarded: 0 } }).onConflictDoNothing();
    const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key)).for('update');
    const st = row!.value as Day;
    if (st.runs.length >= NIGHT_RUN.runsPerDay) fail('no_runs', t('Днес рейсовете свършиха — нов път утре вечер.'));
    const runs = [...st.runs, { metres: result.metres, stars: result.stars, crashes: result.crashes, cans: result.cans, at: now.toISOString() }];
    const best = Math.max(...runs.map((r) => r.stars));
    const xp = (NIGHT_RUN.xp[best] ?? 0) - (NIGHT_RUN.xp[st.awarded] ?? 0);
    if (xp > 0) await awardXp(tx, userId, xp, 'night_run');
    await tx.update(jobState).set({ value: { runs, awarded: Math.max(best, st.awarded) }, updatedAt: now }).where(eq(jobState.key, key));
    return { ...result, xp: Math.max(0, xp), runsLeft: NIGHT_RUN.runsPerDay - runs.length, best: Math.max(...runs.map((r) => r.metres)) };
  });
}

export async function nightRunView(db: DbOrTx, userId: string, now: Date) {
  const day = dayKey(now);
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, runKey(day, userId)));
  const st = (row?.value as Day | undefined) ?? { runs: [], awarded: 0 };
  return { day, runs: st.runs, runsLeft: NIGHT_RUN.runsPerDay - st.runs.length, best: st.runs.reduce((b, r) => Math.max(b, r.metres), 0) };
}

/** Today's longest runs. */
export async function nightRunRanking(db: DbOrTx, now: Date, limit = 10) {
  const day = dayKey(now);
  const prefix = `night-run:${day}:`;
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, `${prefix}%`)).orderBy(desc(jobState.updatedAt)).limit(2000);
  const top = rows
    .map((r) => ({ userId: r.key.slice(prefix.length), best: (r.value as Day).runs.reduce<Run | null>((b, x) => (!b || x.metres > b.metres ? x : b), null) }))
    .filter((x): x is { userId: string; best: Run } => !!x.best)
    .sort((a, b) => b.best.metres - a.best.metres || a.best.at.localeCompare(b.best.at))
    .slice(0, limit);
  if (!top.length) return [];
  const names = new Map((await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, top.map((x) => x.userId)))).map((u) => [u.id, u.username]));
  return top.map((x) => ({ userId: x.userId, username: names.get(x.userId) ?? '—', metres: x.best.metres, stars: x.best.stars }));
}
