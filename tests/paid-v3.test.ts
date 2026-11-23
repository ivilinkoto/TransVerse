import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/game/features';
import { paidProduct } from '@/lib/game/payments';
import { closeDb } from '@/server/db/client';
import { inventoryItems, payments, seasonPasses, users } from '@/server/db/schema';
import { premiumPassOpen } from '@/server/game/season-pass';
import { levelOfferOf, openLevelOffer } from '@/server/game/shop-v2';
import { activeSeason } from '@/server/game/seasons';
import { settlePaid } from '@/server/payments';
import { db, newPlayer } from './helpers';

afterAll(() => closeDb());

async function buy(userId: string, productId: string) {
  const p = paidProduct(productId)!;
  const [row] = await db().insert(payments).values({ userId, provider: 'stripe', productId, coins: p.coins, vipDays: p.vipDays, amountCents: p.priceCents, currency: 'eur', consentAt: new Date() }).returning();
  await db().transaction((tx) => settlePaid(tx, row!, { amountCents: p.priceCents, currency: 'eur' }, {}, new Date()));
}

describe('1.3.2.2: new products for real money', () => {
  it('are in the catalogue under paid_v3', () => {
    expect(FEATURES.paid_v3).toBe('1.3.2.2');
    expect(paidProduct('tc_60')).toMatchObject({ priceCents: 99, coins: 60 });
    expect(paidProduct('vip_plus')).toMatchObject({ priceCents: 1499, coins: 1200, vipDays: 30 });
  });

  it('the pass: premium for the season (Премиум+ with extra points), then no longer for sale', async () => {
    const p = await newPlayer();
    const season = await activeSeason(db());
    expect(await premiumPassOpen(db(), p.userId)).toBe(true);
    await buy(p.userId, 'pass_plus');
    const [row] = await db().select().from(seasonPasses).where(and(eq(seasonPasses.seasonId, season.id), eq(seasonPasses.userId, p.userId)));
    expect(row).toMatchObject({ premium: true, points: 15_000 });
    expect(await premiumPassOpen(db(), p.userId)).toBe(false);
  });

  it('cases, coins, VIP and the money booster', async () => {
    const p = await newPlayer();
    await buy(p.userId, 'gold_cases_10');
    const [cases] = await db().select().from(inventoryItems).where(and(eq(inventoryItems.userId, p.userId), eq(inventoryItems.itemId, 'case_gold')));
    expect(cases?.qty).toBe(10);
    const before = new Date();
    await buy(p.userId, 'vip_plus');
    const [u] = await db().select().from(users).where(eq(users.id, p.userId));
    expect(u!.coins).toBeGreaterThanOrEqual(1200);
    expect(u!.vipUntil!.getTime()).toBeGreaterThan(before.getTime() + 29 * 86_400_000);
    expect(u!.moneyBoostUntil!.getTime()).toBeGreaterThan(before.getTime() + 6.9 * 86_400_000);
    await buy(p.userId, 'speed_pack');
    const [u2] = await db().select().from(users).where(eq(users.id, p.userId));
    expect(u2!.moneyBoostUntil!.getTime()).toBeGreaterThan(u!.moneyBoostUntil!.getTime() + 2.9 * 86_400_000);
  });

  it('a level offer opens for 48 hours at an offer level and is bought once', async () => {
    const p = await newPlayer();
    const now = new Date();
    expect(await levelOfferOf(db(), p.userId, now)).toBeNull();
    await db().transaction((tx) => openLevelOffer(tx, p.userId, 9, 11, now));
    expect(await levelOfferOf(db(), p.userId, now)).toMatchObject({ level: 10 });
    expect(await levelOfferOf(db(), p.userId, new Date(now.getTime() + 49 * 3_600_000))).toBeNull();
    await buy(p.userId, 'level_offer');
    expect(await levelOfferOf(db(), p.userId, now)).toBeNull();
    const [cases] = await db().select().from(inventoryItems).where(and(eq(inventoryItems.userId, p.userId), eq(inventoryItems.itemId, 'case_gold')));
    expect(cases?.qty).toBe(1);
    // No offer between the offer levels.
    await db().transaction((tx) => openLevelOffer(tx, p.userId, 11, 12, now));
    expect(await levelOfferOf(db(), p.userId, now)).toBeNull();
  });
});
