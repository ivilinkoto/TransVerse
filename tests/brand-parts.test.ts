import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { COSMETIC_PARTS, cosmeticVip, parseCosmetic } from '@/lib/game/cosmetics';
import { closeDb } from '@/server/db/client';
import { companies, users, vehicles } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { GameError } from '@/server/game/errors';
import { buyShopItem } from '@/server/game/shop';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : String(e)));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;

describe('1.3.2.3 „Части по марки“', () => {
  it('seven new parts under brand_parts, some styles for VIP only', () => {
    expect(FEATURES.brand_parts).toBe('1.3.2.3');
    const fresh = Object.entries(COSMETIC_PARTS).filter(([, d]) => d.feature === 'brand_parts').map(([k]) => k);
    expect(fresh).toEqual(['rims', 'stacks', 'bullbar', 'stripes', 'twotone', 'aero', 'emblem']);
    expect(parseCosmetic('rims:gold')).toEqual({ part: 'rims', style: 'gold' });
    expect([cosmeticVip('rims', 'gold'), cosmeticVip('stripes', 'gold'), cosmeticVip('emblem', 'crown'), cosmeticVip('rims', 'alloy')]).toEqual([2, 4, 5, 0]);
  });

  it('a part on the truck for coins; VIP styles need the level; stacks only on tractors', async () => {
    const p = await newPlayer();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id));
    await db().transaction((tx) => postCoins(tx, p.userId, { amount: 1_000, reason: 'purchase', description: 'test', idempotencyKey: `parts:${p.userId}` }));
    // The rented starter truck is not one's own: give the player an own rigid truck.
    await db().update(vehicles).set({ ownership: 'owned', modelId: 'hemus-r12-box' }).where(eq(vehicles.id, truck!.id));
    const after = new Date(Math.max(Date.now(), Date.parse('2026-11-24T12:00:00+02:00') + 60_000));
    const buy = (cosmetic: string) => buyShopItem(db(), p.userId, { item: 'truck_part', vehicleId: truck!.id, cosmetic }, after);
    expect(await code(buy('rims:gold'))).toBe('vip_level');
    expect(await code(buy('stacks:chrome'))).toBe('tractor_only');
    const before = await coins(p.userId);
    expect(await code(buy('twotone:black'))).toBe('ok');
    expect(await coins(p.userId)).toBe(before - COSMETIC_PARTS.twotone.price);
    await db().update(users).set({ vipLevel: 2 }).where(eq(users.id, p.userId));
    expect(await code(buy('rims:gold'))).toBe('ok');
    const [row] = await db().select({ c: vehicles.cosmetics }).from(vehicles).where(eq(vehicles.id, truck!.id));
    expect(row!.c).toMatchObject({ twotone: 'black', rims: 'gold' });
  });
});
