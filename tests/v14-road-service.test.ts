import polyline from '@mapbox/polyline';
import { inArray, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the feature as released (before 13.12 it is staff-only).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { closedByWeather, goesOver, PASSES, passById, ROAD_SERVICE } from '@/lib/game/road-service';
import { sofiaDay } from '@/lib/game/shop-v2';
import { closeDb } from '@/server/db/client';
import { contracts, jobState } from '@/server/db/schema';
import { approximateProvider } from '@/server/geo/routing';
import { closedPassOnRoute, ensurePassLoads, passesToday, passGuardians, recordPassDelivery } from '@/server/game/road-service';
import { activeSeason } from '@/server/game/seasons';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const NOW = new Date('2026-12-18T11:00:00+02:00');
const BLIZZARD = { BG: 'blizzard' as const };

describe('1.4 „Пътна служба“', () => {
  it('the passes are real places with real heights', () => {
    expect(new Set(PASSES.map((p) => p.id)).size).toBe(PASSES.length);
    for (const p of PASSES) {
      expect(p.lat).toBeGreaterThan(41);
      expect(p.lat).toBeLessThan(48);
      expect(p.altitude).toBeGreaterThan(500);
    }
    expect(passById('shipka')).toMatchObject({ altitude: 1190, country: 'BG' });
  });

  it('a blizzard closes every pass of the country, ice only the high ones, clear roads none', () => {
    const bg = PASSES.filter((p) => p.country === 'BG');
    expect(bg.every((p) => closedByWeather(p, NOW, { BG: 'blizzard' }))).toBe(true);
    expect(bg.filter((p) => closedByWeather(p, NOW, { BG: 'ice' })).map((p) => p.id).sort()).toEqual(['beklemeto', 'petrohan']);
    expect(bg.some((p) => closedByWeather(p, NOW, { BG: 'clear' }))).toBe(false);
    // Summer, no reading: open.
    expect(closedByWeather(passById('arlberg')!, new Date('2026-07-10T12:00:00+03:00'), null)).toBe(false);
  });

  it('knows when a road goes over a pass', () => {
    const shipka = passById('shipka')!;
    expect(goesOver([[42.70, 25.30], [shipka.lat + 0.005, shipka.lon], [42.82, 25.33]], shipka)).toBe(true);
    expect(goesOver([[42.70, 25.50], [42.82, 25.55]], shipka)).toBe(false);
  });

  it('a trip over a closed pass meets the snowplows; once opened, it does not', async () => {
    const shipka = passById('shipka')!;
    const road = polyline.encode([[42.60, 25.30], [shipka.lat, shipka.lon], [42.90, 25.32]], 6);
    expect((await closedPassOnRoute(db(), road, NOW, BLIZZARD))?.id).toBe('shipka');
    expect(await closedPassOnRoute(db(), road, NOW, { BG: 'clear' })).toBeNull();
    expect(await closedPassOnRoute(db(), null, NOW, BLIZZARD)).toBeNull();
  });

  it('salt and sand open a pass for everyone at 40 t; helpers count for „Пазител на прохода“', async () => {
    const day = sofiaDay(NOW);
    const a = await newPlayer();
    const b = await newPlayer();
    const c1 = await makeContract('Sofia', 'Plovdiv', { tag: 'road_service', cargoType: 'bulk', weightTons: 25 });
    const c2 = await makeContract('Sofia', 'Plovdiv', { tag: 'road_service', cargoType: 'bulk', weightTons: 20 });
    const c3 = await makeContract('Sofia', 'Plovdiv', { tag: 'road_service', cargoType: 'bulk', weightTons: 10 });
    for (const c of [c1, c2, c3]) await db().insert(jobState).values({ key: `pass-load:${c.id}`, value: { pass: 'shipka', day } });
    try {
      const before = (await passesToday(db(), NOW, BLIZZARD)).find((p) => p.pass.id === 'shipka')!;
      expect(before.status).toBe('closed');
      expect(await db().transaction((tx) => recordPassDelivery(tx, c1.id, a.userId, 25, NOW))).toBe('counted');
      expect(await db().transaction((tx) => recordPassDelivery(tx, c2.id, b.userId, 20, NOW))).toBe('opened');
      // The loads still on the market for it are taken off.
      expect((await db().select({ status: contracts.status }).from(contracts).where(inArray(contracts.id, [c3.id])))[0]!.status).toBe('expired');
      // Late loads are paid as usual but count for nothing more.
      expect(await db().transaction((tx) => recordPassDelivery(tx, c3.id, a.userId, 10, NOW))).toBeNull();
      const after = (await passesToday(db(), NOW, BLIZZARD)).find((p) => p.pass.id === 'shipka')!;
      expect(after).toMatchObject({ status: 'opened', tons: 45 });
      expect(await closedPassOnRoute(db(), polyline.encode([[42.6, 25.3], [42.755, 25.319]], 6), NOW, BLIZZARD)).toBeNull();
      const season = await activeSeason(db(), NOW);
      const top = await passGuardians(db(), season.id);
      expect(top.find((g) => g.userId === a.userId)?.tons).toBe(25);
      expect(top.find((g) => g.userId === b.userId)?.tons).toBe(20);
      // An ordinary load is not a road-service load.
      const plain = await makeContract('Sofia', 'Plovdiv');
      expect(await db().transaction((tx) => recordPassDelivery(tx, plain.id, a.userId, 1, NOW))).toBeNull();
    } finally {
      await db().delete(jobState).where(like(jobState.key, `pass:shipka:${day}`));
      await db().delete(jobState).where(inArray(jobState.key, [c1, c2, c3].map((c) => `pass-load:${c.id}`)));
    }
  });

  it('the worker keeps loads on the market for a closed pass, from a city that ships bulk to the town under it', async () => {
    const day = sofiaDay(NOW);
    const made = await ensurePassLoads(db(), NOW, approximateProvider, BLIZZARD);
    const links = await db().select().from(jobState).where(like(jobState.key, 'pass-load:%'));
    const mine = links.filter((l) => (l.value as { day: string }).day === day);
    try {
      expect(made).toBeGreaterThan(0);
      expect(mine.length).toBe(made);
      const ids = mine.map((l) => l.key.slice('pass-load:'.length));
      const rows = await db().select().from(contracts).where(inArray(contracts.id, ids));
      for (const r of rows) {
        expect(r.tag).toBe('road_service');
        expect(r.cargoType).toBe('bulk');
        expect(ROAD_SERVICE.goods as readonly string[]).toContain(r.goods);
      }
      // Topped up, not doubled.
      expect(await ensurePassLoads(db(), NOW, approximateProvider, BLIZZARD)).toBe(0);
    } finally {
      const ids = mine.map((l) => l.key.slice('pass-load:'.length));
      if (ids.length) await db().delete(contracts).where(inArray(contracts.id, ids));
      await db().delete(jobState).where(inArray(jobState.key, mine.map((l) => l.key).concat(['_'])));
    }
  });
});
