import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { BOARD_REFRESH, refreshPrice } from '@/lib/game/board-refresh';
import { FEATURES, featureLive } from '@/lib/game/features';
import { planTrip } from '@/lib/game/schedule';
import { closeDb } from '@/server/db/client';
import { companies, users, vehicles } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { refreshLoads, refreshState } from '@/server/game/contracts';
import { GameError } from '@/server/game/errors';
import { approximateProvider } from '@/server/geo/routing';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const coins = async (id: string) => (await db().select({ coins: users.coins }).from(users).where(eq(users.id, id)))[0]!.coins;

describe('1.2.3.4 new loads for TransCoins', () => {
  it('is live now', () => {
    expect(FEATURES.board_refresh).toBe('1.2.3.4');
    expect(featureLive('board_refresh', new Date('2026-11-08T12:00:00+02:00'))).toBe(true);
  });

  it('free once a day, then each refresh costs twice the last one', () => {
    const now = new Date('2026-11-08T12:00:00Z');
    const at = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
    expect(refreshPrice(null, now)).toBe(0);
    expect(refreshPrice({ freeAt: at(1), paid: 0 }, now)).toBe(5);
    expect(refreshPrice({ freeAt: at(1), paid: 1 }, now)).toBe(10);
    expect(refreshPrice({ freeAt: at(1), paid: 2 }, now)).toBe(20);
    expect(refreshPrice({ freeAt: at(1), paid: 9 }, now)).toBe(BOARD_REFRESH.maxCoins);
    expect(refreshPrice({ freeAt: at(24), paid: 5 }, now)).toBe(0);
  });

  it('makes new loads around the free trucks and takes the coins from the second one on', async () => {
    const p = await newPlayer('Sofia');
    const [co] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, co!.id));
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: 100, reason: 'admin_grant', description: 'test', idempotencyKey: `test:refresh:${p.userId}` }));
    const now = new Date();
    const start = await coins(p.userId);

    const first = await refreshLoads(db(), p.userId, now, approximateProvider);
    expect(first.paidCoins).toBe(0);
    expect(await coins(p.userId)).toBe(start);
    expect((await refreshState(db(), p.userId, now)).price).toBe(5);

    const second = await refreshLoads(db(), p.userId, new Date(now.getTime() + 1000), approximateProvider);
    expect(second.paidCoins).toBe(5);
    const third = await refreshLoads(db(), p.userId, new Date(now.getTime() + 2000), approximateProvider);
    expect(third.paidCoins).toBe(10);
    expect(await coins(p.userId)).toBe(start - 15);
    expect(first.created + second.created + third.created).toBeGreaterThan(0);

    // A day later it is free again.
    expect((await refreshState(db(), p.userId, new Date(now.getTime() + 25 * 3_600_000))).price).toBe(0);

    // Without a free truck: refused, and nothing is taken.
    await db().update(vehicles).set({ status: 'on_delivery' }).where(eq(vehicles.id, truck!.id));
    const before = await coins(p.userId);
    expect(await code(refreshLoads(db(), p.userId, new Date(now.getTime() + 3000), approximateProvider))).toBe('no_free_trucks');
    expect(await coins(p.userId)).toBe(before);
    await db().update(vehicles).set({ status: 'idle' }).where(eq(vehicles.id, truck!.id));
  });
});

describe('1.2.3.4 a double crew swaps at the wheel', () => {
  it('drives a long trip without breaks or a daily rest', () => {
    const leg = { km: 1500, durationS: (1500 / 70) * 3600, borderKms: [] };
    const solo = planTrip({ startAt: 0, empty: null, loaded: leg, speedFactor: 1, timeScale: 1 });
    const team = planTrip({ startAt: 0, empty: null, loaded: leg, speedFactor: 1, timeScale: 1, crew: { startDutyMin: 0, team: true, extraDailyMin: 0 } });
    expect(solo.segments.some((s) => s.kind === 'rest')).toBe(true);
    expect(team.segments.some((s) => s.kind === 'rest' || s.kind === 'break')).toBe(false);
  });
});
