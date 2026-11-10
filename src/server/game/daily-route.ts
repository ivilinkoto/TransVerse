/**
 * 1.3 „Пътят на деня“ on the server. job_state keeps:
 * - `daily-route:<day>` = { cities } — the day's puzzle, fixed at its first view;
 * - `daily-route:<day>:<user>` = { tries: [{ order, km, pct, at }] } — a player's tries;
 * - `daily-route-streak:<user>` = { day, n } — days in a row with a finished puzzle.
 * Rewards go through the ledger once a day (keys per day and level).
 */
import { and, desc, eq, gte, inArray, like } from 'drizzle-orm';
import { bestOrder, DAILY_ROUTE, pathKm, pickCities, routeScore, shareSquares, validOrder, type RouteCity } from '@/lib/game/daily-route';
import { featureLive } from '@/lib/game/features';
import { sofiaDay } from '@/lib/game/shop-v2';
import { playableCountries } from '@/lib/geo/scope';
import type { DbOrTx, Database } from '@/server/db/client';
import { cities, companies, jobState, users } from '@/server/db/schema';
import { fail } from './errors';
import { post } from './finance';
import { t } from '@/i18n/t';

interface Try { order: number[]; km: number; pct: number; at: string }
interface PlayerDay { tries: Try[] }

const puzzleKey = (day: string) => `daily-route:${day}`;
const playerKey = (day: string, userId: string) => `daily-route:${day}:${userId}`;
const streakKey = (userId: string) => `daily-route-streak:${userId}`;

/** The day's six cities (made and stored at the first view of the day). */
export async function puzzleFor(db: DbOrTx, now: Date): Promise<{ day: string; cities: RouteCity[] }> {
  const day = sofiaDay(now);
  const read = async () => (await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, puzzleKey(day))))[0]?.value as { cities: RouteCity[] } | undefined;
  const stored = await read();
  if (stored) return { day, cities: stored.cities };
  const lands = playableCountries(featureLive('europe', now), featureLive('open_world', now));
  const pool = await db
    .select({ id: cities.id, name: cities.nameBg, country: cities.countryCode, lat: cities.lat, lon: cities.lon })
    .from(cities)
    .where(and(gte(cities.population, DAILY_ROUTE.minPopulation), inArray(cities.countryCode, [...lands])));
  // Only cities with a Bulgarian name, and no city districts.
  const picked = pickCities(pool.filter((c) => /[а-яА-Я]/.test(c.name) && !/район|квартал|округ|микрорайон/i.test(c.name)), day);
  if (!picked) fail('no_puzzle', t('Днес няма пъзел — опитай утре.'), 503);
  await db.insert(jobState).values({ key: puzzleKey(day), value: { cities: picked } }).onConflictDoNothing();
  return { day, cities: (await read())!.cities };
}

async function playerDay(db: DbOrTx, day: string, userId: string): Promise<PlayerDay> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, playerKey(day, userId)));
  return (row?.value as PlayerDay | undefined) ?? { tries: [] };
}

/** One try: the order of the cities. Returns the try's length and score. */
export async function guessDailyRoute(db: Database, userId: string, order: number[], now: Date) {
  const { day, cities: list } = await puzzleFor(db, now);
  if (!validOrder(list, order)) fail('bad_order', t('Подреди всички градове, като започнеш от първия.'));
  const best = bestOrder(list);
  return db.transaction(async (tx) => {
    const key = playerKey(day, userId);
    await tx.insert(jobState).values({ key, value: { tries: [] } }).onConflictDoNothing();
    const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key)).for('update');
    const st = row!.value as PlayerDay;
    if (st.tries.length >= DAILY_ROUTE.tries || st.tries.some((x) => x.pct >= 100)) fail('no_tries', t('За днес опитите свършиха — нов път утре.'));
    const km = pathKm(list, order);
    const pct = routeScore(best.km, km);
    const tries = [...st.tries, { order, km: Math.round(km), pct, at: now.toISOString() }];
    await tx.update(jobState).set({ value: { tries }, updatedAt: now }).where(eq(jobState.key, key));
    const finished = tries.length >= DAILY_ROUTE.tries || pct >= 100;
    // Rewards, once a day each: 90% and the best path.
    const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
    let paid = 0;
    for (const [level, r] of Object.entries(DAILY_ROUTE.rewards)) {
      if (pct < r.pct || !company) continue;
      const applied = await post(tx, company.id, [{ category: 'bonus', amountCents: r.cents, description: t('Пътят на деня ({0}%)', r.pct), idempotencyKey: `daily-route:${day}:${userId}:${level}` }]);
      if (applied) paid += r.cents;
    }
    if (finished) await bumpStreak(tx, userId, day);
    return { km: Math.round(km), pct, tries: tries.length, finished, paidCents: paid };
  });
}

/** A finished puzzle extends the streak if yesterday's was finished too. */
async function bumpStreak(tx: DbOrTx, userId: string, day: string) {
  const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, streakKey(userId)));
  const st = row?.value as { day: string; n: number } | undefined;
  if (st?.day === day) return;
  const yesterday = new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const n = st?.day === yesterday ? st.n + 1 : 1;
  await tx.insert(jobState).values({ key: streakKey(userId), value: { day, n } }).onConflictDoUpdate({ target: jobState.key, set: { value: { day, n } } });
}

/** Everything the page needs: the cities, the player's tries, and once finished the best path and the share text. */
export async function dailyRouteView(db: DbOrTx, userId: string, now: Date) {
  const { day, cities: list } = await puzzleFor(db, now);
  const st = await playerDay(db, day, userId);
  const finished = st.tries.length >= DAILY_ROUTE.tries || st.tries.some((x) => x.pct >= 100);
  const best = bestOrder(list);
  const top = st.tries.reduce<Try | null>((b, x) => (!b || x.pct > b.pct ? x : b), null);
  const [streakRow] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, streakKey(userId)));
  const streak = streakRow?.value as { day: string; n: number } | undefined;
  const yesterday = new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const streakNow = streak && (streak.day === day || streak.day === yesterday) ? streak.n : 0;
  return {
    day,
    cities: list,
    tries: st.tries,
    triesLeft: finished ? 0 : DAILY_ROUTE.tries - st.tries.length,
    finished,
    best: finished ? { order: best.order, km: Math.round(best.km) } : null,
    top,
    streak: streakNow,
    share: finished && top ? `TransVerse · ${t('Пътят на деня')} ${day.split('-').reverse().slice(0, 2).join('.')} · ${top.pct}% · ${st.tries.length}/${DAILY_ROUTE.tries}\n${shareSquares(best.order, top.order)}` : null,
  };
}

/** Today's best players: the best try, then fewer tries, then the earlier finish. */
export async function dailyRouteRanking(db: DbOrTx, now: Date, limit = 10) {
  const day = sofiaDay(now);
  const rows = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, `${puzzleKey(day)}:%`)).orderBy(desc(jobState.updatedAt)).limit(2000);
  const scored = rows
    .map((r) => {
      const tries = (r.value as PlayerDay).tries;
      const top = tries.reduce<Try | null>((b, x) => (!b || x.pct > b.pct ? x : b), null);
      return top ? { userId: r.key.slice(puzzleKey(day).length + 1), pct: top.pct, tries: tries.length, at: top.at } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.pct - a.pct || a.tries - b.tries || a.at.localeCompare(b.at))
    .slice(0, limit);
  if (!scored.length) return [];
  const names = new Map((await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, scored.map((s) => s.userId)))).map((u) => [u.id, u.username]));
  return scored.map((s) => ({ ...s, username: names.get(s.userId) ?? '—' }));
}
