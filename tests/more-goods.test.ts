import { and, eq, gte } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));

import { CARGO, CARGO_TYPES } from '@/lib/game/cargo';
import { FEATURES } from '@/lib/game/features';
import { GOODS_TRAITS, goodsFor, goodsMultiplier, goodsTrait, NEW_GOODS } from '@/lib/game/goods';
import { withLocale } from '@/i18n/als';
import { tx } from '@/i18n/t';
import { closeDb } from '@/server/db/client';
import { contracts } from '@/server/db/schema';
import { generateContracts } from '@/server/game/contracts';
import { approximateProvider } from '@/server/geo/routing';
import { cityByName, db } from './helpers';

afterAll(() => closeDb());

describe('1.1.4 more goods', () => {
  it('comes with 1.1.4: 55 new goods, every name once, each translated', () => {
    expect(FEATURES.more_goods).toBe('1.1.4');
    const all = CARGO_TYPES.flatMap((c) => goodsFor(c, true));
    expect(Object.values(NEW_GOODS).flat()).toHaveLength(55);
    expect(new Set(all).size).toBe(all.length);
    for (const c of CARGO_TYPES) expect(goodsFor(c, false)).toEqual(CARGO[c].goods);
    for (const g of Object.values(NEW_GOODS).flat()) {
      expect(withLocale('en', () => tx(g.name)), g.name).not.toBe(g.name);
    }
  });

  it('fragile, valuable and dangerous goods pay more; the rest as before', () => {
    expect(goodsTrait('Ваксини')).toBe('valuable');
    expect(goodsMultiplier('Бензин')).toBe(GOODS_TRAITS.adr.multiplier);
    expect(goodsMultiplier('Вино в бутилки')).toBe(GOODS_TRAITS.fragile.multiplier);
    expect(goodsMultiplier('Мебели')).toBe(1);
    expect(goodsTrait('Запечатан товар')).toBeNull();
  });

  it('the market carries the new goods', async () => {
    const since = new Date();
    const sofia = await cityByName('Sofia');
    for (let i = 0; i < 3; i++) await generateContracts(db(), { originCityId: sofia.id, max: 25, provider: approximateProvider, sizeClass: 'full' });
    const made = await db().select({ goods: contracts.goods, cargo: contracts.cargoType }).from(contracts).where(and(eq(contracts.originCityId, sofia.id), gte(contracts.createdAt, since)));
    expect(made.length).toBeGreaterThan(10);
    const fresh = new Set(Object.values(NEW_GOODS).flat().map((g) => g.name));
    expect(made.some((c) => fresh.has(c.goods))).toBe(true);
    // Each new goods stays on its own cargo (and so on the right trailer).
    for (const c of made.filter((m) => fresh.has(m.goods))) expect(NEW_GOODS[c.cargo as keyof typeof NEW_GOODS].map((g) => g.name)).toContain(c.goods);
  });
});
