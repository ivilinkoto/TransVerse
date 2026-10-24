import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { cityLevel, cityPayFactor, HARVEST, isHarvest } from '@/lib/game/city-growth';
import { closeDb } from '@/server/db/client';
import { cityGrowth, coinEntries, userBadges } from '@/server/db/schema';
import { cityGrowthOf, cityPay, cityRankings, growCity, harvestDelivered } from '@/server/game/city-growth';
import { cityByName, db, newPlayer } from './helpers';

afterAll(() => closeDb());

describe('v1.10 the cities grow', () => {
  it('levels by tonnes and the pay they give', () => {
    expect(cityLevel(0).level).toBe(1);
    expect(cityLevel(1_600).level).toBe(3);
    expect(cityLevel(1_000_000).next).toBeNull();
    expect(cityPayFactor(1)).toBe(1);
    expect(cityPayFactor(5)).toBeCloseTo(1.12);
  });

  it('every delivery adds to the city for everyone; the week resets; loads from it pay more', async () => {
    const city = await cityByName('Ruse');
    await db().delete(cityGrowth).where(eq(cityGrowth.cityId, city.id));
    const monday = new Date('2027-08-02T10:00:00Z');
    await db().transaction((tx) => growCity(tx, city.id, 200, monday));
    await db().transaction((tx) => growCity(tx, city.id, 150, new Date('2027-08-03T10:00:00Z')));
    const g = await cityGrowthOf(db(), city.id);
    expect(g.tons).toBe(350);
    expect(g.level).toBe(2);
    expect(await cityPay(db(), city.id, monday)).toBeCloseTo(1.03);
    const week = await cityRankings(db(), new Date('2027-08-04T10:00:00Z'));
    expect(week.thisWeek.find((c) => c.id === city.id)?.weekTons).toBe(350);
    await db().transaction((tx) => growCity(tx, city.id, 10, new Date('2027-08-10T10:00:00Z')));
    const [row] = await db().select().from(cityGrowth).where(eq(cityGrowth.cityId, city.id));
    expect(row!.weekTons).toBe(10);
    expect(row!.tons).toBe(360);
  });
});

describe('v1.10 Гроздобер', () => {
  it('in season only; ten harvest loads on time — the badge and ТрансКоин once', async () => {
    expect(isHarvest(new Date('2027-09-20T10:00:00Z'))).toBe(true);
    expect(isHarvest(new Date('2027-11-20T10:00:00Z'))).toBe(false);
    const p = await newPlayer();
    const at = new Date('2027-09-20T10:00:00Z');
    await db().transaction((tx) => harvestDelivered(tx, p.userId, 'harvest', true, at));
    for (let i = 0; i < HARVEST.loadsForBadge + 2; i++) await db().transaction((tx) => harvestDelivered(tx, p.userId, 'harvest', false, at));
    await db().transaction((tx) => harvestDelivered(tx, p.userId, 'sowing', false, at));
    const coins = await db().select().from(coinEntries).where(and(eq(coinEntries.userId, p.userId), eq(coinEntries.reason, 'harvest')));
    expect(coins).toHaveLength(1);
    expect(coins[0]!.amount).toBe(HARVEST.coins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, HARVEST.badge)))).toHaveLength(1);
  });
});
