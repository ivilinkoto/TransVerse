import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

/** 1.3 „Пътят на деня“: the day's puzzle, tries, rewards once a day, the streak and the ranking. */
import { bestOrder, crowKm, DAILY_ROUTE, pathKm, pickCities, routeScore, shareSquares, validOrder, type RouteCity } from '@/lib/game/daily-route';
import { closeDb } from '@/server/db/client';
import { companies } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { dailyRouteRanking, dailyRouteView, guessDailyRoute, puzzleFor } from '@/server/game/daily-route';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const balance = async (userId: string) => (await db().select({ b: companies.balanceCents }).from(companies).where(eq(companies.ownerId, userId)))[0]!.b;

const square: RouteCity[] = [
  { id: 1, name: 'A', country: 'BG', lat: 42, lon: 23 },
  { id: 2, name: 'B', country: 'BG', lat: 42, lon: 25 },
  { id: 3, name: 'C', country: 'BG', lat: 43, lon: 25 },
  { id: 4, name: 'D', country: 'BG', lat: 43, lon: 23 },
];

describe('1.3 „Пътят на деня“ — rules', () => {
  it('distances, the best order and the score', () => {
    expect(Math.round(crowKm({ lat: 42.6977, lon: 23.3219 }, { lat: 43.2141, lon: 27.9147 }))).toBe(378); // Sofia — Varna
    const best = bestOrder(square);
    expect(best.order[0]).toBe(1);
    // From A the best is along the edges, never across the diagonal twice.
    expect(best.km).toBeCloseTo(pathKm(square, [1, 4, 3, 2]), 6);
    expect(routeScore(best.km, best.km)).toBe(100);
    expect(routeScore(100, 125)).toBe(80);
    expect(shareSquares([1, 2, 3, 4], [1, 2, 4, 3])).toBe('🟩🟨🟨');
  });

  it('a guess must start at the first city and visit every city once', () => {
    expect(validOrder(square, [1, 2, 3, 4])).toBe(true);
    expect(validOrder(square, [2, 1, 3, 4])).toBe(false);
    expect(validOrder(square, [1, 2, 2, 4])).toBe(false);
    expect(validOrder(square, [1, 2, 3])).toBe(false);
    expect(validOrder(square, [1, 2, 3, 9])).toBe(false);
  });

  it('the same day gives the same cities, near the start and apart', () => {
    const pool: RouteCity[] = Array.from({ length: 80 }, (_, i) => ({ id: 1000 + i, name: `C${i}`, country: 'BG', lat: 41 + (i % 9) * 0.6, lon: 22 + Math.floor(i / 9) * 0.7 }));
    const a = pickCities(pool, '2026-11-12')!;
    expect(a).toHaveLength(DAILY_ROUTE.cities);
    expect(pickCities([...pool].reverse(), '2026-11-12')!.map((c) => c.id)).toEqual(a.map((c) => c.id));
    expect(pickCities(pool, '2026-11-13')!.map((c) => c.id)).not.toEqual(a.map((c) => c.id));
    for (const c of a.slice(1)) {
      const d = crowKm(a[0]!, c);
      expect(d).toBeGreaterThanOrEqual(DAILY_ROUTE.near[0]);
      expect(d).toBeLessThanOrEqual(DAILY_ROUTE.near[1]);
    }
    for (const x of a) for (const y of a) if (x.id !== y.id) expect(crowKm(x, y)).toBeGreaterThanOrEqual(DAILY_ROUTE.apart);
  });
});

describe('1.3 „Пътят на деня“ — on the server', () => {
  const day = new Date('2026-11-14T12:00:00+02:00');

  it('one puzzle for everybody, from real cities', async () => {
    const a = await puzzleFor(db(), day);
    const b = await puzzleFor(db(), new Date('2026-11-14T22:00:00+02:00'));
    expect(a.cities).toHaveLength(DAILY_ROUTE.cities);
    expect(b.cities.map((c) => c.id)).toEqual(a.cities.map((c) => c.id));
    expect(a.day).toBe('2026-11-14');
  });

  it('three tries, the best path pays both rewards once, then no more tries', async () => {
    const p = await newPlayer();
    const start = await balance(p.userId);
    const { cities } = await puzzleFor(db(), day);
    const best = bestOrder(cities);
    const worst = [best.order[0]!, ...best.order.slice(1).reverse()];
    expect(await code(guessDailyRoute(db(), p.userId, [cities[1]!.id, cities[0]!.id, ...cities.slice(2).map((c) => c.id)], day))).toBe('bad_order');

    const first = await guessDailyRoute(db(), p.userId, worst, day);
    expect(first.tries).toBe(1);
    expect(first.finished).toBe(first.pct >= 100);
    const view = await dailyRouteView(db(), p.userId, day);
    expect(view.best).toBeNull(); // the answer only once the puzzle is over
    expect(view.triesLeft).toBe(DAILY_ROUTE.tries - 1);

    const perfect = await guessDailyRoute(db(), p.userId, best.order, day);
    expect(perfect.pct).toBe(100);
    expect(perfect.finished).toBe(true);
    const paid = DAILY_ROUTE.rewards.good.cents + DAILY_ROUTE.rewards.perfect.cents;
    expect(await balance(p.userId)).toBe(start + paid);
    expect(await code(guessDailyRoute(db(), p.userId, best.order, day))).toBe('no_tries');

    const done = await dailyRouteView(db(), p.userId, day);
    expect(done.best!.order).toEqual(best.order);
    expect(done.share).toContain('100%');
    expect(done.share).toContain('🟩🟩🟩🟩🟩');
    expect(done.streak).toBe(1);

    const ranking = await dailyRouteRanking(db(), day);
    expect(ranking.find((r) => r.userId === p.userId)).toMatchObject({ pct: 100, tries: 2 });
  });

  it('the streak grows with puzzles finished on days in a row', async () => {
    const p = await newPlayer();
    for (const [i, d] of ['2026-11-15', '2026-11-16'].entries()) {
      const when = new Date(`${d}T12:00:00+02:00`);
      const { cities } = await puzzleFor(db(), when);
      await guessDailyRoute(db(), p.userId, bestOrder(cities).order, when);
      expect((await dailyRouteView(db(), p.userId, when)).streak).toBe(i + 1);
    }
    // A day missed: the streak is gone.
    expect((await dailyRouteView(db(), p.userId, new Date('2026-11-18T12:00:00+02:00'))).streak).toBe(0);
  });
});
