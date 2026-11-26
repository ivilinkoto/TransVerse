import { eq } from 'drizzle-orm';
import { blackFridayCoins, isBlackFriday } from '@/lib/game/prewinter';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { depotCoinSlotPrice, ECONOMY } from '@/lib/game/economy';
import { closeDb } from '@/server/db/client';
import { companies, depots, users } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { GameError } from '@/server/game/errors';
import { expandDepot, expandDepotCoins } from '@/server/game/fleet';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

// The prices in ТрансКоин as on the day the test runs (−30 % on Black Friday, 27–30 Nov).
const bf = (n: number, at = new Date()) => blackFridayCoins(n, isBlackFriday(at));

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;

describe('1.3.2.2: depot places 21–25 for ТрансКоин', () => {
  it('prices each place past 20 and none before or after', () => {
    expect(FEATURES.premium_slots).toBe('1.3.2.2');
    expect(depotCoinSlotPrice(19)).toBeNull();
    expect(depotCoinSlotPrice(20)).toBe(150);
    expect(depotCoinSlotPrice(24)).toBe(350);
    expect(depotCoinSlotPrice(25)).toBeNull();
  });

  it('money up to 20, coins after, up to 25', async () => {
    const p = await newPlayer();
    const [acc] = await db().select({ id: companies.id }).from(companies).where(eq(companies.ownerId, p.userId));
    const [depot] = await db().select().from(depots).where(eq(depots.companyId, acc!.id));
    expect(await code(expandDepotCoins(db(), p.userId, depot!.id))).toBe('max_slots');
    await db().update(depots).set({ slots: ECONOMY.depotMaxSlots }).where(eq(depots.id, depot!.id));
    expect(await code(expandDepot(db(), p.userId, depot!.id))).toBe('max_slots');
    expect(await code(expandDepotCoins(db(), p.userId, depot!.id))).toBe('insufficient_coins');
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: 2_000, reason: 'purchase', description: 'test', idempotencyKey: `slot-coins:${p.userId}` }));
    for (let i = 0; i < 5; i++) await expandDepotCoins(db(), p.userId, depot!.id);
    expect(await coins(p.userId)).toBe(2_000 - bf(150) - bf(200) - bf(250) - bf(300) - bf(350));
    expect((await db().select().from(depots).where(eq(depots.id, depot!.id)))[0]!.slots).toBe(25);
    expect(await code(expandDepotCoins(db(), p.userId, depot!.id))).toBe('max_slots');
  });
});
