import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

/** 1.3 „Нощен рейс“: a fair daily road, the server's replay, three runs and XP only for a better best. */
import { carY, NIGHT_RUN, nightRoad, replayRun, runStars, speedAt, startRun, stepRun } from '@/lib/game/night-run';
import { dayKey } from '@/lib/game/daily';
import { closeDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { nightRunRanking, nightRunView, playNightRun } from '@/server/game/night-run';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));

/** A simple careful driver: changes lanes when a car is close ahead, prefers cans. */
function drive(day: string): number[] {
  const road = nightRoad(day);
  const s = startRun();
  const inputs: number[] = [];
  while (!s.over) {
    let steer = 0;
    if (s.from === s.to) {
      const v = speedAt(s);
      const danger = (lane: number) => road.cars.some((c, i) => !s.hitCars.has(i) && c.lane === lane && carY(c, s.tick) - s.y > -5 && carY(c, s.tick) - s.y < (v - c.v) * 0.7 + 9);
      const safe = [s.to, s.to - 1, s.to + 1].filter((l) => l >= 0 && l < NIGHT_RUN.lanes && !danger(l));
      if (danger(s.to) && safe.length) steer = Math.sign(safe[0]! - s.to);
    }
    inputs.push(steer);
    stepRun(s, road, steer);
  }
  return inputs;
}

describe('1.3 „Нощен рейс“ — rules', () => {
  it('the same road for everybody that day, another the next', () => {
    expect(nightRoad('2026-11-12')).toEqual(nightRoad('2026-11-12'));
    expect(nightRoad('2026-11-13').cars[0]).not.toEqual(nightRoad('2026-11-12').cars[0]);
  });

  it('a pair of cars side by side always leaves a lane free', () => {
    for (const day of ['2026-11-12', '2026-11-15', '2026-11-20']) {
      const rows = new Map<number, number>();
      for (const c of nightRoad(day).cars) rows.set(c.y, (rows.get(c.y) ?? 0) + 1);
      expect(Math.max(...rows.values())).toBeLessThan(NIGHT_RUN.lanes);
    }
  });

  it('driving straight on gets little; careful driving gets far; the replay is exact', () => {
    const day = '2026-11-12';
    const straight = replayRun(day, []);
    const careful = drive(day);
    const run = replayRun(day, careful);
    expect(run.metres).toBeGreaterThan(straight.metres + 500);
    expect(replayRun(day, careful)).toEqual(run);
    expect(runStars(899)).toBe(0);
    expect(runStars(2100)).toBe(3);
  });
});

describe('1.3 „Нощен рейс“ — on the server', () => {
  const now = new Date('2026-11-14T21:00:00+02:00');

  it('three runs a day, XP only for a better best', async () => {
    const p = await newPlayer();
    const xp0 = (await db().select({ xp: users.xp }).from(users).where(eq(users.id, p.userId)))[0]!.xp;
    const good = await playNightRun(db(), p.userId, drive(dayKey(now)), now);
    expect(good.stars).toBeGreaterThan(0);
    expect(good.xp).toBe(NIGHT_RUN.xp[good.stars]);
    const worse = await playNightRun(db(), p.userId, [], now);
    expect(worse.xp).toBe(0);
    await playNightRun(db(), p.userId, [], now);
    expect(await code(playNightRun(db(), p.userId, [], now))).toBe('no_runs');
    const xp1 = (await db().select({ xp: users.xp }).from(users).where(eq(users.id, p.userId)))[0]!.xp;
    expect(xp1 - xp0).toBe(NIGHT_RUN.xp[good.stars]);
    const view = await nightRunView(db(), p.userId, now);
    expect(view.runsLeft).toBe(0);
    expect(view.best).toBe(good.metres);
    const ranking = await nightRunRanking(db(), now);
    expect(ranking.find((r) => r.userId === p.userId)?.metres).toBe(good.metres);
  });
});
