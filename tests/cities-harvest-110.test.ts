import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

// These tests check the features as released (before the date they are staff-only; see tests/release-gating.test.ts).
vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));
import { HARVEST, isHarvest } from '@/lib/game/city-growth';
import { closeDb } from '@/server/db/client';
import { coinEntries, userBadges } from '@/server/db/schema';
import { harvestDelivered } from '@/server/game/harvest';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

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
