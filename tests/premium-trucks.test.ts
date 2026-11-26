import { eq } from 'drizzle-orm';
import { blackFridayCoins, isBlackFriday } from '@/lib/game/prewinter';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { modelAvailable, POWER_UNITS, PREMIUM_TRUCK, PREMIUM_TRUCKS } from '@/lib/game/catalog';
import { closeDb } from '@/server/db/client';
import { users, vehicles } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { GameError } from '@/server/game/errors';
import { buyPremiumTruck, buyVehicle } from '@/server/game/fleet';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

// The prices in ТрансКоин as on the day the test runs (−30 % on Black Friday, 27–30 Nov).
const bf = (n: number, at = new Date()) => blackFridayCoins(n, isBlackFriday(at));

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;

describe('1.3.2.2: premium trucks for ТрансКоин, from VIP2', () => {
  it('are a 1.3.2.2 feature, never on the money market, and better than the trucks they sit next to', () => {
    expect(FEATURES.premium_trucks).toBe('1.3.2.2');
    expect(PREMIUM_TRUCKS().length).toBe(3);
    for (const m of PREMIUM_TRUCKS()) {
      expect(modelAvailable(m, () => true), m.id).toBe(false);
      expect(m.premium!.coins).toBeGreaterThan(0);
    }
    const t440 = POWER_UNITS.find((m) => m.id === 'danubia-t500-eco')!;
    const sig = POWER_UNITS.find((m) => m.id === 'danubia-t560-signature')!;
    expect(sig.fuelFull).toBeLessThan(t440.fuelFull);
    expect(sig.powerHp).toBeGreaterThan(t440.powerHp);
  });

  it('needs VIP2, the level and the coins; costs coins, not money', async () => {
    const p = await newPlayer();
    const model = 'hemus-r20-express';
    expect(await code(buyVehicle(db(), p.userId, model, p.hq.id))).toBe('unknown_model');
    await db().update(users).set({ level: 3, vipLevel: 1 }).where(eq(users.id, p.userId));
    expect(await code(buyPremiumTruck(db(), p.userId, model, p.hq.id))).toBe('vip_level');
    await db().update(users).set({ vipLevel: PREMIUM_TRUCK.vipLevel }).where(eq(users.id, p.userId));
    expect(await code(buyPremiumTruck(db(), p.userId, model, p.hq.id))).toBe('insufficient_coins');
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: 700, reason: 'purchase', description: 'test', idempotencyKey: `premium-coins:${p.userId}` }));
    const v = await buyPremiumTruck(db(), p.userId, model, p.hq.id);
    expect(await coins(p.userId)).toBe(700 - bf(600));
    const [row] = await db().select().from(vehicles).where(eq(vehicles.id, v.id));
    expect(row).toMatchObject({ modelId: model, color: PREMIUM_TRUCK.color });
  });
});
