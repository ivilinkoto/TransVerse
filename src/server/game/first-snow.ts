/**
 * 1.2.5 „Първи сняг“ on the server: the weekly pass tasks, clearing the roads
 * together and „Крал на снега“. Everything lives in job_state:
 * - `pass-tasks:<season>:<week>:<user>` = { p: {kind: n}, done: [taskId], countries: [cc] }
 * - `plow:<country>:<day>` = { tons, clearedAt }; `plow-tons:<season>:<user>` = { tons }
 * - `snow-king:<season>:<user>` = { tons }; `snow-king-awarded:<season>` once the titles are given.
 */
import { desc, eq, inArray, like, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { FIRST_SNOW, PASS_TASK, PLOW, SNOW_EVENTS, SNOW_KING, taskIncrements, TITLES, weekTasks, type PassTaskKind } from '@/lib/game/first-snow';
import { passVersion } from '@/lib/game/season-pass';
import { isoWeek, sofiaDay } from '@/lib/game/shop-v2';
import { isWinter, roadCondition, type RealConditions, type RoadCondition } from '@/lib/game/winter';
import { isPrewinter } from '@/lib/game/prewinter';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { jobState, seasons, userBadges, users } from '@/server/db/schema';
import { postCoins } from './coins';
import { fail } from './errors';
import { notify } from './notify';
import { addPassPoints } from './season-pass';
import { activeSeason } from './seasons';
import { t } from '@/i18n/t';

/** This week's tasks: the winter-loads task only when the week's Sunday is in the pre-winter or winter dates. */
function tasksFor(now: Date) {
  const dow = (new Date(`${sofiaDay(now)}T12:00:00Z`).getUTCDay() + 6) % 7;
  const sunday = new Date(now.getTime() + (6 - dow) * 86_400_000);
  return weekTasks(isoWeek(now), isPrewinter(sunday) || isWinter(sunday));
}

interface TaskState { p: Partial<Record<PassTaskKind, number>>; done: string[]; countries: string[] }

const taskKey = (seasonId: number, week: string, userId: string) => `pass-tasks:${seasonId}:${week}:${userId}`;

/** This week's tasks and the player's progress (null when the season's pass has no tasks). */
export async function passTasksView(db: DbOrTx, userId: string, now: Date) {
  const season = await activeSeason(db, now);
  if (passVersion(season.rules) !== 2) return null;
  const week = isoWeek(now);
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, taskKey(season.id, week, userId)));
  const st = (row?.value as TaskState | undefined) ?? { p: {}, done: [], countries: [] };
  return tasksFor(now).map((task) => ({ ...task, progress: Math.min(task.target, st.p[task.kind] ?? 0), done: st.done.includes(task.id), points: PASS_TASK.points }));
}

export interface SnowFacts { userId: string; loadedKm: number; late: boolean; cargoType: string; convoy: boolean; destCountry: string; tons: number; holiday: string | null; goods: string; roadEvents: { kind: string }[]; /** The player drove this truck themselves (only such trips count for the weekly tasks). */ ownerDrove: boolean }

/** A delivery arrived: the weekly tasks, clearing the roads and „Крал на снега“ (seasons with the new pass only). */
export async function recordSnowSeason(tx: Tx, f: SnowFacts, at: Date) {
  if (!featureLive('season_v2', at)) return;
  const season = await activeSeason(tx, at);
  if (passVersion(season.rules) !== 2) return;
  // Weekly tasks count only the trips the player drives themselves: a big fleet with hired drivers does not finish them faster.
  if (f.ownerDrove) await recordTasks(tx, season.id, f, at);
  await recordPlow(tx, season.id, f, at);
  if (f.roadEvents.some((e) => (SNOW_EVENTS as readonly string[]).includes(e.kind))) await addTons(tx, `snow-king:${season.id}:${f.userId}`, f.tons, at);
}

async function recordTasks(tx: Tx, seasonId: number, f: SnowFacts, at: Date) {
  const week = isoWeek(at);
  const key = taskKey(seasonId, week, f.userId);
  await tx.insert(jobState).values({ key, value: { p: {}, done: [], countries: [] } }).onConflictDoNothing();
  const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key)).for('update');
  const st = row!.value as TaskState;
  const inc = taskIncrements(f, st.countries);
  const p = { ...st.p };
  for (const k of Object.keys(inc) as PassTaskKind[]) p[k] = (p[k] ?? 0) + inc[k];
  const countries = st.countries.includes(f.destCountry) ? st.countries : [...st.countries, f.destCountry];
  const done = [...st.done];
  for (const task of tasksFor(at)) {
    if (done.includes(task.id) || (p[task.kind] ?? 0) < task.target) continue;
    done.push(task.id);
    await addPassPoints(tx, f.userId, PASS_TASK.points, at);
    await notify(tx, f.userId, 'achievement', () => t('Задача за пропуска: {0}', task.label), () => t('+{0} точки за пропуска.', PASS_TASK.points), '/game/pass');
  }
  await tx.update(jobState).set({ value: { p, done, countries }, updatedAt: at }).where(eq(jobState.key, key));
}

async function addTons(tx: Tx, key: string, tons: number, at: Date) {
  const [row] = await tx
    .insert(jobState)
    .values({ key, value: { tons } })
    .onConflictDoUpdate({ target: jobState.key, set: { value: sql`jsonb_set(${jobState.value}, '{tons}', to_jsonb(coalesce((${jobState.value}->>'tons')::numeric, 0) + ${tons}))`, updatedAt: at } })
    .returning({ value: jobState.value });
  return Number((row!.value as { tons: number }).tons);
}

/** Salt, sand or lye to a country under snow, ice or a blizzard: the day's tonnes, pass points and the title. */
async function recordPlow(tx: Tx, seasonId: number, f: SnowFacts, at: Date) {
  if (!(PLOW.goods as readonly string[]).includes(f.goods) || roadCondition(f.destCountry, at) === 'clear') return;
  const dayKey = `plow:${f.destCountry}:${sofiaDay(at)}`;
  const before = await plowTons(tx, f.destCountry, at);
  const total = await addTons(tx, dayKey, f.tons, at);
  await addPassPoints(tx, f.userId, Math.round(f.tons * PLOW.pointsPerTon), at);
  if (before < PLOW.tonsPerDay && total >= PLOW.tonsPerDay) {
    await tx.update(jobState).set({ value: sql`jsonb_set(${jobState.value}, '{clearedAt}', to_jsonb(${at.toISOString()}::text))` }).where(eq(jobState.key, dayKey));
  }
  const mine = await addTons(tx, `plow-tons:${seasonId}:${f.userId}`, f.tons, at);
  if (mine >= PLOW.titleTons && mine - f.tons < PLOW.titleTons) {
    await tx.insert(userBadges).values({ userId: f.userId, badge: 'road-clearer', awardedAt: at }).onConflictDoNothing();
    await notify(tx, f.userId, 'achievement', () => t('Титла: {0}', TITLES['road-clearer']!.label), () => t('{0} т сол и пясък по заснежените пътища.', PLOW.titleTons), '/game/profile');
  }
}

async function plowTons(db: DbOrTx, country: string, now: Date) {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, `plow:${country}:${sofiaDay(now)}`));
  return Number((row?.value as { tons?: number } | undefined)?.tons ?? 0);
}

/** Countries whose roads were cleared today (the goal of the day reached). */
export async function clearedCountries(db: DbOrTx, now: Date): Promise<Set<string>> {
  if (!featureLive('season_v2', now)) return new Set();
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, `plow:%:${sofiaDay(now)}`));
  return new Set(rows.filter((r) => (r.value as { clearedAt?: string }).clearedAt).map((r) => r.key.split(':')[1]!));
}

const LOWER: Record<RoadCondition, RoadCondition> = { blizzard: 'ice', ice: 'snow', snow: 'clear', clear: 'clear' };

/** The real-weather overrides with the cleared countries one step easier (for planning a trip and the board). */
export function withCleared(countries: readonly string[], now: Date, real: RealConditions | null | undefined, cleared: Set<string>): RealConditions | null | undefined {
  if (!cleared.size) return real;
  const out: RealConditions = { ...(real ?? {}) };
  for (const c of countries) if (cleared.has(c)) out[c] = LOWER[roadCondition(c, now, real)];
  return out;
}

/** Today's clearing: the countries under snow with the tonnes so far. */
export async function plowToday(db: DbOrTx, now: Date) {
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, `plow:%:${sofiaDay(now)}`));
  return rows.map((r) => ({ country: r.key.split(':')[1]!, tons: Math.round(Number((r.value as { tons: number }).tons)), cleared: !!(r.value as { clearedAt?: string }).clearedAt })).sort((a, b) => b.tons - a.tons);
}

/** „Крал на снега“: the season's ranking by tonnes through snow, ice and closed passes. */
export async function snowKings(db: DbOrTx, seasonId: number, limit = 10) {
  const rows = await db
    .select({ key: jobState.key, tons: sql<number>`(${jobState.value}->>'tons')::float` })
    .from(jobState)
    .where(like(jobState.key, `snow-king:${seasonId}:%`))
    .orderBy(desc(sql`(${jobState.value}->>'tons')::float`))
    .limit(limit);
  const ids = rows.map((r) => r.key.split(':')[2]!);
  const names = ids.length ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids)) : [];
  return rows.map((r, i) => ({ place: i + 1, userId: ids[i]!, username: names.find((n) => n.id === ids[i])?.username ?? '—', tons: Math.round(r.tons) }));
}

/** Worker: when a season with the snow theme is over, the top three get their titles and ТрансКоин (once). */
export async function awardSnowKings(db: Database, now = new Date()) {
  const done = await db.select({ id: seasons.id, rules: seasons.rules }).from(seasons).where(eq(seasons.status, 'finished')).orderBy(desc(seasons.id)).limit(3);
  let n = 0;
  for (const s of done.filter((x) => (x.rules as { theme?: string }).theme === FIRST_SNOW.theme)) {
    const [first] = await db.insert(jobState).values({ key: `snow-king-awarded:${s.id}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning();
    if (!first) continue;
    const top = await snowKings(db, s.id, SNOW_KING.places.length);
    await db.transaction(async (tx) => {
      for (const k of top) {
        const prize = SNOW_KING.places[k.place - 1]!;
        await tx.insert(userBadges).values({ userId: k.userId, badge: prize.title, awardedAt: now }).onConflictDoNothing();
        await postCoins(tx, k.userId, { amount: prize.coins, reason: 'challenge', description: t('Крал на снега · място {0}', k.place), idempotencyKey: `snow-king:${s.id}:${k.userId}` });
        await notify(tx, k.userId, 'achievement', () => t('Крал на снега: място {0}!', k.place), () => t('Титла „{0}“ и {1} TC.', TITLES[prize.title]!.label, prize.coins), '/game/profile');
        n++;
      }
    });
  }
  return n;
}

/** The titles a player owns (title badges). */
export async function titlesOf(db: DbOrTx, userId: string) {
  const rows = await db.select({ badge: userBadges.badge }).from(userBadges).where(eq(userBadges.userId, userId));
  return rows.map((r) => r.badge).filter((b) => b in TITLES);
}

/** Shows one of the player's titles next to the name, or none. */
export async function setTitle(db: Database, userId: string, title: string | null) {
  if (title && !(await titlesOf(db, userId)).includes(title)) fail('no_title', t('Нямаш тази титла.'), 403);
  await db.update(users).set({ title }).where(eq(users.id, userId));
  return { title };
}
