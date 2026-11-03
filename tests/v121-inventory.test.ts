import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/game/features', async (load) => ({ ...(await load<typeof import('@/lib/game/features')>()), featureLive: () => true }));

import { SECTIONS, LISTED_SECTIONS, sectionFor } from '@/components/game/nav';
import { FEATURES } from '@/lib/game/features';
import { COLLECTIONS, ITEMS, ITEM_IDS, RECIPES, SELL_DAY_CAP, SELL_PRICE, craftPool, craftUp, matchRecipe, sourcesOf, tradable } from '@/lib/game/items';
import { WEEKLY_CHEST } from '@/lib/game/item-chests';
import { releaseByVersion } from '@/lib/game/releases';
import { closeDb } from '@/server/db/client';
import { cities, coinEntries, companies, companyChest, deliveries, drivers, friendships, inventoryItems, itemEffects, itemSerials, notifications, userBadges, users, vehicles } from '@/server/db/schema';
import { GameError } from '@/server/game/errors';
import { applyItem, grantItem, nextSerial, openCase } from '@/server/game/inventory';
import {
  addToCompanyChest,
  answerTrade,
  claimWeeklyChest,
  craftItems,
  foundItems,
  giftItem,
  giveFromChest,
  hallOfFame,
  inventoryBadge,
  itemFinds,
  knownRecipes,
  offerTrade,
  openGift,
  pendingExchanges,
  provenance,
  sellItem,
  unequipLook,
  weeklyChest,
} from '@/server/game/item-trade';
import { membershipOf } from '@/server/game/membership';
import { acceptContract } from '@/server/game/deliveries';
import { db, makeContract, newPlayer, playerWithCompany } from './helpers';

afterAll(() => closeDb());

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));
const qty = async (userId: string, itemId: string) => (await db().select().from(inventoryItems).where(and(eq(inventoryItems.userId, userId), eq(inventoryItems.itemId, itemId))))[0]?.qty ?? 0;
const give = (userId: string, itemId: keyof typeof ITEMS, n = 1) => db().transaction((tx) => grantItem(tx, userId, itemId, n, 'test', `t121:${itemId}:${userId}:${Math.random()}`));
const coins = async (userId: string) => (await db().select({ c: users.coins }).from(users).where(eq(users.id, userId)))[0]!.c;
const setLevel = (userId: string, level: number) => db().update(users).set({ level }).where(eq(users.id, userId));

describe('1.2.1 inventory — rules', () => {
  it('registers the features under 1.2.1 and the release notes them', () => {
    for (const id of ['inventory_menu', 'item_trade', 'workshop', 'item_album', 'item_chests'] as const) expect(FEATURES[id]).toBe('1.2.1');
    const r = releaseByVersion('1.2.1')!;
    expect(r.name).toBe('Раницата');
    expect(r.highlights.length).toBeGreaterThanOrEqual(4);
  });

  it('the inventory is its own section, listed apart; without the feature it stays under „Автопарк“', () => {
    expect(SECTIONS.find((s) => s.key === 'inventory')).toBeTruthy();
    expect(LISTED_SECTIONS.find((s) => s.key === 'inventory')).toBeUndefined();
    expect(sectionFor('/game/inventory/workshop')?.key).toBe('inventory');
    expect(sectionFor('/game/inventory', (f) => f !== 'inventory_menu')?.key).toBe('fleet');
  });

  it('every item has a source or is a reward; collections hold known items; recipes make real items', () => {
    for (const c of COLLECTIONS) for (const i of c.items) expect(ITEM_IDS).toContain(i);
    for (const r of RECIPES) {
      expect(ITEM_IDS).toContain(r.makes);
      for (const k of Object.keys(r.needs)) expect(ITEM_IDS).toContain(k);
    }
    for (const id of ITEM_IDS.filter((x) => ITEMS[x].kind !== 'coins' && x !== 'case_bronze' && x !== 'case_silver' && x !== 'case_gold')) expect(sourcesOf(id).length, id).toBeGreaterThan(0);
  });

  it('workshop: three of a kind go up one rarity; seasonal and bound items stay out of the pool', () => {
    expect(craftUp('case_bronze')).toEqual({ kind: 'case', item: 'case_silver' });
    expect(craftUp('case_silver')).toEqual({ kind: 'case', item: 'case_gold' });
    expect(craftUp('case_gold')).toBeNull();
    expect(craftUp('golden_key')).toBeNull();
    const up = craftUp('coffee');
    expect(up?.kind).toBe('pool');
    if (up?.kind === 'pool') for (const x of up.pool) expect(ITEMS[x].rarity).toBe('uncommon');
    expect(craftPool('rare')).not.toContain('snow_chains');
    expect(craftPool('legendary')).not.toContain('golden_key');
    expect(matchRecipe(['thermos', 'coffee', 'coffee'])?.makes).toBe('cab_coffee');
    expect(matchRecipe(['coffee', 'thermos'])).toBeNull();
    expect(tradable('golden_key')).toBe(false);
    expect(SELL_PRICE).toEqual({ common: 2, uncommon: 4, rare: 8, epic: 15, legendary: 30 });
  });
});

describe('1.2.1 inventory — sell, gift, trade', () => {
  it('sells within the daily cap, keeps the last collectible, never sells cases', async () => {
    const p = await playerWithCompany();
    await give(p.userId, 'fuel_voucher', 30);
    await give(p.userId, 'old_tachograph', 1);
    const before = await coins(p.userId);
    expect(await sellItem(db(), p.userId, 'fuel_voucher', 3)).toEqual({ sold: 3, coins: 6 });
    expect(await coins(p.userId)).toBe(before + 6);
    expect(await code(sellItem(db(), p.userId, 'old_tachograph', 1))).toBe('no_spare');
    expect(await code(sellItem(db(), p.userId, 'case_bronze', 1))).toBe('not_sellable');
    // The cap: 50 TC a day.
    const r = await sellItem(db(), p.userId, 'fuel_voucher', 99);
    expect(r.coins).toBe(SELL_DAY_CAP - 6);
    expect(await code(sellItem(db(), p.userId, 'fuel_voucher', 1))).toBe('sell_cap');
    const sold = await db().select().from(coinEntries).where(and(eq(coinEntries.userId, p.userId), eq(coinEntries.reason, 'item_sale')));
    expect(sold.reduce((s, e) => s + e.amount, 0)).toBe(SELL_DAY_CAP);
  });

  it('a present goes only to a friend, leaves at once and is opened by the friend', async () => {
    const a = await playerWithCompany();
    const b = await playerWithCompany();
    await setLevel(a.userId, 3);
    await give(a.userId, 'sunglasses', 1);
    expect(await code(giftItem(db(), a.userId, { toUserId: b.userId, itemId: 'sunglasses' }))).toBe('not_friends');
    await db().insert(friendships).values({ requesterId: a.userId, addresseeId: b.userId, status: 'accepted' });
    const { id } = await giftItem(db(), a.userId, { toUserId: b.userId, itemId: 'sunglasses', note: 'За път!' });
    expect(await qty(a.userId, 'sunglasses')).toBe(0);
    expect((await pendingExchanges(db(), b.userId)).gifts.map((g) => g.note)).toEqual(['За път!']);
    expect((await inventoryBadge(db(), b.userId, undefined, new Date())).fresh).toBeGreaterThanOrEqual(1);
    expect(await openGift(db(), b.userId, id)).toMatchObject({ item: 'sunglasses' });
    expect(await qty(b.userId, 'sunglasses')).toBe(1);
    expect(await code(openGift(db(), b.userId, id))).toBe('gift_not_found');
  });

  it('a trade holds the offer, swaps on accept, gives back on decline; level 5 and not the same network', async () => {
    const a = await playerWithCompany();
    const b = await playerWithCompany();
    const [bu] = await db().select({ username: users.username }).from(users).where(eq(users.id, b.userId));
    await give(a.userId, 'thermos', 2);
    await give(b.userId, 'queue_ticket', 1);
    expect(await code(offerTrade(db(), a.userId, { toUsername: bu!.username, give: 'thermos', want: 'queue_ticket' }, null))).toBe('trade_level');
    await setLevel(a.userId, 5);
    await setLevel(b.userId, 5);
    await db().update(users).set({ signupIpHash: 'same-net' }).where(eq(users.id, b.userId));
    expect(await code(offerTrade(db(), a.userId, { toUsername: bu!.username, give: 'thermos', want: 'queue_ticket' }, 'same-net'))).toBe('same_network');
    const t1 = await offerTrade(db(), a.userId, { toUsername: bu!.username, give: 'thermos', want: 'queue_ticket' }, 'other-net');
    expect(await qty(a.userId, 'thermos')).toBe(1);
    expect(await code(answerTrade(db(), a.userId, t1.id, 'accept'))).toBe('forbidden');
    expect(await answerTrade(db(), b.userId, t1.id, 'accept')).toEqual({ status: 'accepted' });
    expect(await qty(a.userId, 'queue_ticket')).toBe(1);
    expect(await qty(b.userId, 'thermos')).toBe(1);
    expect(await qty(b.userId, 'queue_ticket')).toBe(0);
    // Declined: the offer comes back.
    const t2 = await offerTrade(db(), a.userId, { toUsername: bu!.username, give: 'thermos', want: 'queue_ticket' }, 'other-net');
    expect(await qty(a.userId, 'thermos')).toBe(0);
    await answerTrade(db(), b.userId, t2.id, 'decline');
    expect(await qty(a.userId, 'thermos')).toBe(1);
    expect(await code(answerTrade(db(), b.userId, t2.id, 'accept'))).toBe('trade_not_found');
  });

  it('the golden key is bound: no sale, gift or trade', async () => {
    const p = await playerWithCompany();
    expect(await code(sellItem(db(), p.userId, 'golden_key', 1))).toBe('not_sellable');
    expect(await code(giftItem(db(), p.userId, { toUserId: p.userId, itemId: 'golden_key' }))).toBe('not_giftable');
  });
});

describe('1.2.1 inventory — looks, workshop, finds, album', () => {
  it('frames: one at a time; taking a look off gives the item back', async () => {
    const p = await playerWithCompany();
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [d] = await db().insert(drivers).values({ companyId: acc!.id, name: 'Петър Тестов', skill: 1, salaryCentsPerDay: 100_00 }).returning();
    await give(p.userId, 'frost_frame', 1);
    await give(p.userId, 'gold_frame', 1);
    await applyItem(db(), p.userId, 'frost_frame', { driverId: d!.id });
    expect((await db().select().from(drivers).where(eq(drivers.id, d!.id)))[0]!.look).toEqual({ frame: 'frost' });
    expect(await code(applyItem(db(), p.userId, 'gold_frame', { driverId: d!.id }))).toBe('has_look');
    expect(await unequipLook(db(), p.userId, d!.id, 'frame')).toEqual({ item: 'frost_frame' });
    expect(await qty(p.userId, 'frost_frame')).toBe(1);
    expect(await code(unequipLook(db(), p.userId, d!.id, 'frame'))).toBe('no_look');
  });

  it('workshop: three bronze cases make a silver one; a recipe is noted once', async () => {
    const p = await playerWithCompany();
    await give(p.userId, 'case_bronze', 3);
    expect(await craftItems(db(), p.userId, ['case_bronze', 'case_bronze', 'case_bronze'])).toMatchObject({ item: 'case_silver' });
    expect(await qty(p.userId, 'case_bronze')).toBe(0);
    expect(await qty(p.userId, 'case_silver')).toBe(1);
    await give(p.userId, 'coffee', 4);
    await give(p.userId, 'thermos', 2);
    expect(await craftItems(db(), p.userId, ['coffee', 'thermos', 'coffee'])).toEqual({ item: 'cab_coffee', recipe: 'cab_coffee', discovered: true });
    expect((await craftItems(db(), p.userId, ['coffee', 'coffee', 'thermos'])).discovered).toBe(false);
    expect(await knownRecipes(db(), p.userId)).toEqual(['cab_coffee']);
    expect(await code(craftItems(db(), p.userId, ['coffee', 'thermos']))).toBe('no_recipe');
    expect(await code(craftItems(db(), p.userId, ['coffee', 'coffee', 'coffee']))).toBe('no_item');
  });

  it('a full new collection gives the badge, the ТрансКоин and the frame — once', async () => {
    const p = await playerWithCompany();
    const c = COLLECTIONS.find((x) => x.id === 'xmas')!;
    const before = await coins(p.userId);
    for (const i of c.items) await give(p.userId, i, 1);
    await give(p.userId, c.items[0]!, 1);
    expect(await coins(p.userId)).toBe(before + c.coins);
    expect(await db().select().from(userBadges).where(and(eq(userBadges.userId, p.userId), eq(userBadges.badge, c.badge)))).toHaveLength(1);
    expect(await qty(p.userId, c.frame!)).toBe(1);
    expect([...(await foundItems(db(), p.userId)).keys()]).toEqual(expect.arrayContaining(c.items));
    expect((await provenance(db(), p.userId, [c.items[0]!]))[c.items[0]!]?.reason).toBe('test');
    const hall = await hallOfFame(db());
    expect(hall.collections.find((x) => x.id === 'xmas')!.first.some((f) => f.userId === p.userId)).toBe(true);
  });

  it('numbered keys: numbers go up and stop at 50', async () => {
    const p = await playerWithCompany();
    await db().delete(itemSerials).where(eq(itemSerials.itemId, 'golden_key'));
    const first = await db().transaction((tx) => nextSerial(tx, 'golden_key', p.userId));
    expect(first).toBe(1);
    await db().insert(itemSerials).values({ itemId: 'golden_key', serial: 50, userId: p.userId });
    expect(await db().transaction((tx) => nextSerial(tx, 'golden_key', p.userId))).toBeNull();
    await db().delete(itemSerials).where(eq(itemSerials.itemId, 'golden_key'));
  });

  it('a gold case can give the numbered key (rand under the chance)', async () => {
    const p = await playerWithCompany();
    await db().delete(itemSerials).where(eq(itemSerials.itemId, 'golden_key'));
    await give(p.userId, 'case_gold', 1);
    const r = await openCase(db(), p.userId, 'case_gold', new Date(), () => 0.5, () => 0);
    expect(r).toMatchObject({ item: 'golden_key', serial: 1 });
    expect((await provenance(db(), p.userId, ['golden_key'])).golden_key?.serials).toEqual([1]);
    await db().delete(itemSerials).where(eq(itemSerials.itemId, 'golden_key'));
  });

  it('the treasure map points to a city; a delivery there gives a case once', async () => {
    const p = await playerWithCompany();
    await give(p.userId, 'treasure_map', 1);
    const now = new Date();
    const r = await applyItem(db(), p.userId, 'treasure_map', {}, now);
    expect(r.result).toMatch(/48/);
    const [map] = await db().select().from(itemEffects).where(and(eq(itemEffects.userId, p.userId), eq(itemEffects.effect, 'treasure')));
    expect(map!.data?.cityId).toBeTruthy();
    const got = await db().transaction((tx) => itemFinds(tx, { userId: p.userId, deliveryId: '00000000-0000-0000-0000-000000000121', destCityId: map!.data!.cityId! }, new Date(now.getTime() + 3_600_000)));
    expect(got.some((x) => x === 'case_silver' || x === 'case_gold')).toBe(true);
    const again = await db().transaction((tx) => itemFinds(tx, { userId: p.userId, deliveryId: '00000000-0000-0000-0000-000000000122', destCityId: map!.data!.cityId! }, new Date(now.getTime() + 7_200_000)));
    expect(again.some((x) => x === 'case_silver' || x === 'case_gold')).toBe(false);
  });

  it('a souvenir can only come from a delivery in its country', async () => {
    const p = await playerWithCompany();
    const [sofia] = await db().select({ id: cities.id }).from(cities).where(eq(cities.countryCode, 'BG')).limit(1);
    for (let i = 0; i < 60; i++) {
      const got = await db().transaction((tx) => itemFinds(tx, { userId: p.userId, deliveryId: `00000000-0000-0000-0000-${String(500 + i).padStart(12, '0')}`, destCityId: sofia!.id }, new Date('2026-06-01T10:00:00Z')));
      expect(got.filter((x) => x.startsWith('souvenir_'))).toEqual([]);
    }
  });
});

describe('1.2.1 inventory — chests', () => {
  it('the weekly chest follows the week’s deliveries and is taken once', async () => {
    const p = await newPlayer();
    expect(await code(claimWeeklyChest(db(), p.userId))).toBe('chest_locked');
    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [truck] = await db().select().from(vehicles).where(eq(vehicles.companyId, acc!.id)).limit(1);
    const first = await makeContract('Sofia', 'Plovdiv');
    const d = await acceptContract(db(), p.userId, first.id, truck!.id);
    const [row] = await db().select().from(deliveries).where(eq(deliveries.id, d.id));
    const { id: _id, ...rest } = row!;
    for (let i = 0; i < WEEKLY_CHEST[0]!.trips; i++) {
      const c = await makeContract('Sofia', 'Plovdiv');
      await db().insert(deliveries).values({ ...rest, contractId: c.id, status: 'completed', completedAt: new Date() });
    }
    const w = await weeklyChest(db(), p.userId, new Date());
    expect(w.trips).toBe(WEEKLY_CHEST[0]!.trips);
    expect(w.tier?.item).toBe('case_bronze');
    expect(await claimWeeklyChest(db(), p.userId)).toEqual({ item: 'case_bronze' });
    expect(await code(claimWeeklyChest(db(), p.userId))).toBe('chest_claimed');
  });

  it('the company chest fills once per cause; only the owner gives it out', async () => {
    const owner = await playerWithCompany();
    const m = (await membershipOf(db(), owner.userId))!;
    expect(m.rank.isOwner).toBe(true);
    expect(await db().transaction((tx) => addToCompanyChest(tx, m.company.id, 'case_gold', 1, 'battle_win', `t121-chest:${m.company.id}`, new Date()))).toBe(true);
    expect(await db().transaction((tx) => addToCompanyChest(tx, m.company.id, 'case_gold', 1, 'battle_win', `t121-chest:${m.company.id}`, new Date()))).toBe(false);
    expect((await db().select().from(companyChest).where(eq(companyChest.organizationId, m.company.id)))[0]!.qty).toBe(1);
    await giveFromChest(db(), owner.userId, owner.userId, 'case_gold');
    expect(await qty(owner.userId, 'case_gold')).toBe(1);
    expect(await code(giveFromChest(db(), owner.userId, owner.userId, 'case_gold'))).toBe('chest_empty');
    expect((await db().select().from(notifications).where(eq(notifications.userId, owner.userId))).length).toBeGreaterThan(0);
  });
});
