import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the feature as released (before 13.12 it is staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { COURIER, courierDay, nearestNode, replayCourier, shortestPath } from '@/lib/game/courier';
import { COURIER_CITIES } from '@/lib/game/courier-graph';
import { dayKey } from '@/lib/game/daily';
import { closeDb } from '@/server/db/client';
import { courierGraph, courierRanking, courierView, playCourier } from '@/server/game/courier';
import { GameError } from '@/server/game/errors';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

/** A plain player: the nearer end of the nearest parcel (by the navigator), then the other end. */
function greedyTaps(city: string, day: string) {
  const g = courierGraph(city)!;
  const job = courierDay(g, day);
  let at = g.depot;
  const taps: number[] = [];
  const left = new Set(job.parcels);
  while (left.size) {
    let best: { e: number; a: number; b: number; d: number } | null = null;
    for (const e of left) {
      const [a, b, , , oneway] = g.edges[e]!;
      for (const [x, y] of oneway ? [[a, b]] : [[a, b], [b, a]]) {
        const p = shortestPath(g, at, x!);
        const d = p!.reduce((s, i) => s + g.edges[i]![2], 0);
        if (!best || d < best.d) best = { e, a: x!, b: y!, d };
      }
    }
    taps.push(best!.a, best!.b);
    at = best!.b;
    left.delete(best!.e);
  }
  return taps;
}

describe('1.4 „Градски куриер“', () => {
  it('the three centres are real street graphs where every junction can be reached', () => {
    for (const c of COURIER_CITIES) {
      const g = courierGraph(c.id)!;
      expect(g.nodes.length).toBeGreaterThan(800);
      expect(g.names.length).toBeGreaterThan(100);
      const [s, w, n, e] = c.bbox;
      for (const [lat, lon] of g.nodes) {
        expect(lat >= s && lat <= n && lon >= w && lon <= e).toBe(true);
      }
      for (let i = 0; i < g.nodes.length; i += Math.ceil(g.nodes.length / 25)) {
        expect(shortestPath(g, g.depot, i)).not.toBeNull();
        expect(shortestPath(g, i, g.depot)).not.toBeNull();
      }
    }
  });

  it('the navigator keeps to one-way streets', () => {
    const g = courierGraph('sofia')!;
    for (let i = 0; i < g.nodes.length; i += 97) {
      let at = g.depot;
      for (const e of shortestPath(g, g.depot, i)!) {
        const [a, b, , , oneway] = g.edges[e]!;
        if (oneway) expect(a).toBe(at);
        at = a === at ? b : a;
      }
      expect(at).toBe(i);
    }
  });

  it('the day: the same 8 parcels and jams for everyone, a new job tomorrow', () => {
    const g = courierGraph('plovdiv')!;
    const a = courierDay(g, '2026-12-14');
    expect(a.parcels).toHaveLength(COURIER.parcels);
    expect(new Set(a.parcels).size).toBe(COURIER.parcels);
    expect(courierDay(g, '2026-12-14')).toEqual(a);
    expect(courierDay(g, '2026-12-15').parcels).not.toEqual(a.parcels);
    expect(a.jams.size).toBeGreaterThan(5);
    for (const p of a.parcels) {
      expect(a.jams.has(p)).toBe(false);
      expect(g.edges[p]![5]).toBeGreaterThanOrEqual(0);
    }
  });

  it('a plain player delivers most parcels; the clock stops at the limit; bad taps do nothing', () => {
    let total = 0;
    for (const c of COURIER_CITIES) for (const day of ['2026-12-14', '2026-12-15', '2026-12-16']) {
      const r = replayCourier(courierGraph(c.id)!, courierDay(courierGraph(c.id)!, day), greedyTaps(c.id, day));
      expect(r.timeS).toBeLessThanOrEqual(COURIER.limitS);
      total += r.delivered.length;
    }
    expect(total / 9).toBeGreaterThanOrEqual(6);
    const g = courierGraph('varna')!;
    const job = courierDay(g, '2026-12-14');
    expect(replayCourier(g, job, [-1, 1e9, 2.5, g.depot]).path).toEqual([]);
    // Back and forth across the whole centre until the time is out.
    const far = nearestNode(g, 43.215, 27.892);
    const long = replayCourier(g, job, Array.from({ length: 40 }, (_, i) => (i % 2 ? g.depot : far)));
    expect(long.timeS).toBe(COURIER.limitS);
  });

  it('the server replays the shift, gives XP once for the best stars and keeps 3 shifts a day', async () => {
    const p = await newPlayer();
    const now = new Date();
    const taps = greedyTaps('sofia', dayKey(now));
    const first = await playCourier(db(), p.userId, 'sofia', taps, now);
    const local = replayCourier(courierGraph('sofia')!, courierDay(courierGraph('sofia')!, dayKey(now)), taps);
    expect(first).toMatchObject({ delivered: local.delivered.length, points: local.points, stars: local.stars, runsLeft: 2 });
    expect(first.xp).toBe(COURIER.xp[local.stars]);
    const again = await playCourier(db(), p.userId, 'sofia', taps, now);
    expect(again.xp).toBe(0);
    await playCourier(db(), p.userId, 'varna', [], now);
    expect(await code(playCourier(db(), p.userId, 'sofia', taps, now))).toBe('no_runs');
    expect((await courierView(db(), p.userId, now)).runsLeft).toBe(0);
    const top = await courierRanking(db(), 'sofia', now);
    expect(top.find((r) => r.userId === p.userId)?.points).toBe(local.points);
    expect(await code(playCourier(db(), p.userId, 'burgas', [], now))).toBe('no_city');
  });
});
