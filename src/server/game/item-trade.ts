import { randomInt } from 'node:crypto';
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, like, lt, notInArray, or, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { alias } from 'drizzle-orm/pg-core';
import { cities, coinEntries, companyChest, companyChestLog, companyMembers, deliveries, drivers, friendships, inventoryItems, itemEffects, itemGifts, itemLog, itemSerials, itemTrades, userBadges, users } from '@/server/db/schema';
import {
  COLLECTIONS,
  CRAFT_SAME,
  FRAME_ITEMS,
  ITEMS,
  RECEIVED_REASONS,
  RECIPES,
  SEASON_FIND,
  SELL_DAY_CAP,
  SELL_PRICE,
  SOUVENIRS,
  TRADE_RULES,
  TREASURE,
  craftUp,
  matchRecipe,
  pickFrom,
  tradable,
  type CaseId,
  type ItemId,
} from '@/lib/game/items';
import { WEEKLY_CHEST, CHEST_REWARDS } from '@/lib/game/item-chests';
import { hash, periodWindow, sofiaMidnight } from '@/lib/game/missions';
import { inSeasonWindow, sofiaMonthDay } from '@/lib/game/seasonal';
import { featureFor } from '@/server/features';
import { featureLive } from '@/lib/game/features';
import { t } from '@/i18n/t';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { grantItem, takeItem } from './inventory';
import { membershipOf } from './membership';
import { notify } from './notify';

/**
 * 1.2.1: what players do with items besides using them — sell a spare one for
 * ТрансКоин, wrap one as a present for a friend, trade one for another, take a
 * cosmetic off, combine items in the workshop — and the new places items come
 * from (seasonal finds, souvenirs, the treasure map, the weekly and company chests).
 * Every move goes through grantItem / takeItem with a unique key.
 */
const known = (id: string): id is ItemId => id in ITEMS;
const nonce = (now: Date) => `${now.getTime()}:${randomInt(0, 1e9)}`;

function sofiaDayStart(now: Date) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number);
  return sofiaMidnight(y!, m!, d!);
}

// ── Sell ─────────────────────────────────────────────────────────────────

/** ТрансКоин from sales today (Sofia day). */
export async function soldToday(db: DbOrTx, userId: string, now: Date) {
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`coalesce(sum(${coinEntries.amount}), 0)::int` }).from(coinEntries).where(and(eq(coinEntries.userId, userId), eq(coinEntries.reason, 'item_sale'), gte(coinEntries.createdAt, sofiaDayStart(now))));
  return n;
}

/**
 * Sells up to `qty` of an item for ТрансКоин by rarity (a collectible keeps one in
 * the album), within the daily cap. Cases, coins and bound items are not sold.
 */
export async function sellItem(db: Database, userId: string, itemId: string, qty: number, now = new Date()) {
  if (!known(itemId) || !tradable(itemId) || ITEMS[itemId].kind === 'case') fail('not_sellable', t('Този предмет не се продава.'));
  const id = itemId as ItemId;
  const price = SELL_PRICE[ITEMS[id].rarity];
  return db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const left = SELL_DAY_CAP - (await soldToday(tx, userId, now));
    const [row] = await tx.select({ qty: inventoryItems.qty }).from(inventoryItems).where(and(eq(inventoryItems.userId, userId), eq(inventoryItems.itemId, id)));
    const spare = Math.max(0, (row?.qty ?? 0) - (ITEMS[id].kind === 'collectible' ? 1 : 0));
    if (spare < 1) fail('no_spare', ITEMS[id].kind === 'collectible' ? t('Пазиш последния за албума — продават се само повторените.') : t('Нямаш този предмет.'));
    const n = Math.min(Math.max(1, Math.floor(qty)), spare, Math.floor(left / price));
    if (n < 1) fail('sell_cap', t('Днес продаде за {0} ТрансКоин — това е таванът. Утре пак.', SELL_DAY_CAP));
    const key = `sell:${userId}:${id}:${nonce(now)}`;
    await takeItem(tx, userId, id, 'sell', key, n);
    await postCoins(tx, userId, { amount: n * price, reason: 'item_sale', description: t('Продадени: {0} ×{1}', ITEMS[id].name, n), idempotencyKey: key });
    return { sold: n, coins: n * price };
  });
}

// ── Gifts ────────────────────────────────────────────────────────────────

export const GIFT_RULES = { perDay: 5, minLevel: 3 };

async function areFriends(tx: DbOrTx, a: string, b: string) {
  const [f] = await tx
    .select({ id: friendships.id })
    .from(friendships)
    .where(and(eq(friendships.status, 'accepted'), or(and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)), and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a)))));
  return !!f;
}

/** Wraps an item as a present for a friend (with a short note); the friend opens it. */
export async function giftItem(db: Database, userId: string, input: { toUserId: string; itemId: string; note?: string }, now = new Date()) {
  if (!known(input.itemId) || !tradable(input.itemId)) fail('not_giftable', t('Този предмет не се подарява.'));
  if (input.toUserId === userId) fail('self_gift', t('Не може да подариш на себе си.'));
  const id = input.itemId as ItemId;
  return db.transaction(async (tx) => {
    const [me] = await tx.select({ username: users.username, level: users.level }).from(users).where(eq(users.id, userId)).for('update');
    if (!me || me.level < GIFT_RULES.minLevel) fail('gift_level', t('Подаръци се пращат от ниво {0}.', GIFT_RULES.minLevel));
    if (!(await areFriends(tx, userId, input.toUserId))) fail('not_friends', t('Подаръци се пращат само на приятели.'));
    const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(itemGifts).where(and(eq(itemGifts.fromUserId, userId), gte(itemGifts.createdAt, sofiaDayStart(now))));
    if (n >= GIFT_RULES.perDay) fail('gift_cap', t('Днес вече изпрати {0} подаръка.', GIFT_RULES.perDay));
    const note = input.note?.trim().slice(0, TRADE_RULES.noteMax) || null;
    const [gift] = await tx.insert(itemGifts).values({ fromUserId: userId, toUserId: input.toUserId, itemId: id, note, createdAt: now }).returning({ id: itemGifts.id });
    await takeItem(tx, userId, id, 'gift_out', `gift:${gift!.id}:out`);
    await notify(tx, input.toUserId, 'success', () => t('🎁 Подарък от {0}', me!.username), () => t('Чака те опакован подарък в „Инвентар“.'), '/game/inventory');
    return { id: gift!.id };
  });
}

/** Opens a present: the item comes into the inventory. */
export async function openGift(db: Database, userId: string, giftId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [g] = await tx.update(itemGifts).set({ openedAt: now }).where(and(eq(itemGifts.id, giftId), eq(itemGifts.toUserId, userId), isNull(itemGifts.openedAt))).returning();
    if (!g) fail('gift_not_found', t('Подаръкът не е намерен.'), 404);
    await grantItem(tx, userId, g!.itemId as ItemId, 1, 'gift_in', `gift:${g!.id}:in`);
    return { item: g!.itemId as ItemId, note: g!.note };
  });
}

// ── Trades ───────────────────────────────────────────────────────────────

/** Offers one item for another to a player (level 5+, not from the same network); the offer is held until the answer. */
export async function offerTrade(db: Database, userId: string, input: { toUsername: string; give: string; want: string; note?: string }, ipHash: string | null, now = new Date()) {
  if (!known(input.give) || !tradable(input.give) || !known(input.want) || !tradable(input.want) || ITEMS[input.want].kind === 'coins') fail('not_tradable', t('Тези предмети не се разменят.'));
  if (input.give === input.want) fail('same_item', t('Избери различен предмет за размяна.'));
  return db.transaction(async (tx) => {
    const [me] = await tx.select({ id: users.id, username: users.username, level: users.level, ip: users.signupIpHash }).from(users).where(eq(users.id, userId)).for('update');
    const [to] = await tx.select({ id: users.id, username: users.username, level: users.level, ip: users.signupIpHash, bannedAt: users.bannedAt }).from(users).where(sql`lower(${users.username}) = lower(${input.toUsername.trim()})`);
    if (!to || to.bannedAt) fail('player_not_found', t('Няма такъв играч.'), 404);
    if (to!.id === userId) fail('self_trade', t('Не може да разменяш със себе си.'));
    if (me!.level < TRADE_RULES.minLevel || to!.level < TRADE_RULES.minLevel) fail('trade_level', t('Размените са за играчи от ниво {0}.', TRADE_RULES.minLevel));
    if (to!.ip && (to!.ip === me!.ip || to!.ip === ipHash)) fail('same_network', t('Не може да разменяш с профил от същата мрежа.'), 403);
    const [{ n = 0 } = {}] = await tx.select({ n: count() }).from(itemTrades).where(and(eq(itemTrades.fromUserId, userId), eq(itemTrades.status, 'open')));
    if (n >= TRADE_RULES.openMax) fail('trade_cap', t('Имаш {0} отворени предложения — изчакай отговор или откажи някое.', TRADE_RULES.openMax));
    const note = input.note?.trim().slice(0, TRADE_RULES.noteMax) || null;
    const [trade] = await tx.insert(itemTrades).values({ fromUserId: userId, toUserId: to!.id, giveItem: input.give, wantItem: input.want, note, createdAt: now }).returning({ id: itemTrades.id });
    await takeItem(tx, userId, input.give as ItemId, 'trade_hold', `trade:${trade!.id}:hold`);
    await notify(tx, to!.id, 'info', () => t('🔁 {0} предлага размяна', me!.username), () => t('{0} срещу твоя {1}. Виж „Инвентар“.', ITEMS[input.give as ItemId].name, ITEMS[input.want as ItemId].name), '/game/inventory');
    return { id: trade!.id };
  });
}

/** Accepts or declines an offer (the receiver), or takes it back (the sender). */
export async function answerTrade(db: Database, userId: string, tradeId: string, answer: 'accept' | 'decline' | 'cancel', now = new Date()) {
  return db.transaction(async (tx) => {
    const [tr] = await tx.select().from(itemTrades).where(eq(itemTrades.id, tradeId)).for('update');
    if (!tr || tr.status !== 'open') fail('trade_not_found', t('Предложението вече не е отворено.'), 404);
    const mine = answer === 'cancel' ? tr!.fromUserId === userId : tr!.toUserId === userId;
    if (!mine) fail('forbidden', t('Нямате достъп.'), 403);
    const give = tr!.giveItem as ItemId;
    const want = tr!.wantItem as ItemId;
    if (answer === 'accept') {
      await takeItem(tx, userId, want, 'trade_out', `trade:${tr!.id}:out`);
      await grantItem(tx, userId, give, 1, 'trade_in', `trade:${tr!.id}:to`);
      await grantItem(tx, tr!.fromUserId, want, 1, 'trade_in', `trade:${tr!.id}:from`);
      await tx.update(itemTrades).set({ status: 'accepted', respondedAt: now }).where(eq(itemTrades.id, tr!.id));
      await notify(tx, tr!.fromUserId, 'success', () => t('🔁 Размяната е приета'), () => t('Получи {0} срещу {1}.', ITEMS[want].name, ITEMS[give].name), '/game/inventory');
      return { status: 'accepted' as const };
    }
    await grantItem(tx, tr!.fromUserId, give, 1, 'trade_back', `trade:${tr!.id}:back`);
    await tx.update(itemTrades).set({ status: answer === 'cancel' ? 'cancelled' : 'declined', respondedAt: now }).where(eq(itemTrades.id, tr!.id));
    if (answer === 'decline') await notify(tx, tr!.fromUserId, 'info', () => t('🔁 Размяната е отказана'), () => t('{0} се върна в инвентара.', ITEMS[give].name), '/game/inventory');
    return { status: answer === 'cancel' ? ('cancelled' as const) : ('declined' as const) };
  });
}

/** Presents waiting to be opened and open trades, both ways. */
export async function pendingExchanges(db: DbOrTx, userId: string) {
  const from = alias(users, 'from_user');
  const to = alias(users, 'to_user');
  const gifts = await db.select({ id: itemGifts.id, itemId: itemGifts.itemId, note: itemGifts.note, from: from.username, at: itemGifts.createdAt }).from(itemGifts).innerJoin(from, eq(from.id, itemGifts.fromUserId)).where(and(eq(itemGifts.toUserId, userId), isNull(itemGifts.openedAt))).orderBy(asc(itemGifts.createdAt));
  const trades = await db
    .select({ id: itemTrades.id, give: itemTrades.giveItem, want: itemTrades.wantItem, note: itemTrades.note, fromId: itemTrades.fromUserId, from: from.username, to: to.username, at: itemTrades.createdAt })
    .from(itemTrades)
    .innerJoin(from, eq(from.id, itemTrades.fromUserId))
    .innerJoin(to, eq(to.id, itemTrades.toUserId))
    .where(and(eq(itemTrades.status, 'open'), or(eq(itemTrades.fromUserId, userId), eq(itemTrades.toUserId, userId))))
    .orderBy(desc(itemTrades.createdAt));
  return {
    gifts: gifts.filter((g) => known(g.itemId)).map((g) => ({ ...g, itemId: g.itemId as ItemId })),
    incoming: trades.filter((x) => x.fromId !== userId && known(x.give) && known(x.want)).map((x) => ({ ...x, give: x.give as ItemId, want: x.want as ItemId })),
    outgoing: trades.filter((x) => x.fromId === userId && known(x.give) && known(x.want)).map((x) => ({ ...x, give: x.give as ItemId, want: x.want as ItemId })),
  };
}

// ── Cosmetics off ───────────────────────────────────────────────────────

/** Takes a cosmetic off a driver's portrait; the item goes back into the inventory. */
export async function unequipLook(db: Database, userId: string, driverId: string, part: 'cap' | 'glasses' | 'frame', now = new Date()) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [d] = await tx.select().from(drivers).where(and(eq(drivers.id, driverId), eq(drivers.companyId, company.id))).for('update');
    if (!d) fail('driver_not_found', t('Шофьорът не е намерен.'), 404);
    const look = { ...(d!.look ?? {}) };
    let item: ItemId;
    if (part === 'cap' && look.cap) {
      delete look.cap;
      item = 'trucker_cap';
    } else if (part === 'glasses' && look.glasses) {
      delete look.glasses;
      item = 'sunglasses';
    } else if (part === 'frame' && look.frame) {
      item = FRAME_ITEMS[look.frame];
      delete look.frame;
    } else return fail('no_look', t('{0} не носи това.', d!.name));
    await tx.update(drivers).set({ look }).where(eq(drivers.id, d!.id));
    await grantItem(tx, userId, item, 1, 'unequip', `unequip:${d!.id}:${part}:${nonce(now)}`);
    return { item };
  });
}

// ── Workshop ─────────────────────────────────────────────────────────────

/**
 * Combines items: three of a kind make one of the next rarity (or the next case);
 * otherwise the items must match a recipe exactly. A recipe made for the first
 * time goes into „Тетрадка на механика“.
 */
export async function craftItems(db: Database, userId: string, raw: string[], now = new Date(), rand: () => number = () => randomInt(0, 1_000_000) / 1_000_000) {
  if (raw.length < 2 || raw.length > 4 || !raw.every(known)) fail('bad_craft', t('Сложи 2–4 предмета в работилницата.'));
  const items = raw as ItemId[];
  const same = items.length === CRAFT_SAME && items.every((x) => x === items[0]);
  const recipe = same ? null : matchRecipe(items);
  let result: ItemId;
  let reason: string;
  if (same) {
    const up = craftUp(items[0]!);
    if (!up) fail('no_upgrade', t('{0} не може да стане по-рядък.', ITEMS[items[0]!].name));
    result = up!.kind === 'case' ? up!.item : up!.pool[Math.floor(rand() * up!.pool.length)]!;
    reason = 'craft:same';
  } else if (recipe) {
    result = recipe.makes;
    reason = `craft:${recipe.id}`;
  } else return fail('no_recipe', t('Нищо не се получи — тази комбинация не е рецепта.'));
  return db.transaction(async (tx) => {
    const key = `craft:${userId}:${nonce(now)}`;
    const counts = items.reduce<Partial<Record<ItemId, number>>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
    for (const [id, n] of Object.entries(counts) as [ItemId, number][]) await takeItem(tx, userId, id, reason, `${key}:${id}`, n);
    const [before] = recipe ? await tx.select({ id: itemLog.id }).from(itemLog).where(and(eq(itemLog.userId, userId), eq(itemLog.reason, reason), gt(itemLog.delta, 0))).limit(1) : [undefined];
    await grantItem(tx, userId, result, 1, reason, `${key}:out`);
    return { item: result, recipe: recipe?.id ?? null, discovered: !!recipe && !before };
  });
}

/** The recipes the player has made at least once („Тетрадка на механика“). */
export async function knownRecipes(db: DbOrTx, userId: string) {
  const rows = await db.selectDistinct({ reason: itemLog.reason }).from(itemLog).where(and(eq(itemLog.userId, userId), like(itemLog.reason, 'craft:%'), gt(itemLog.delta, 0)));
  const ids = new Set(rows.map((r) => r.reason.slice('craft:'.length)));
  return RECIPES.filter((r) => ids.has(r.id)).map((r) => r.id);
}

// ── Finds after a delivery ──────────────────────────────────────────────

const roll = (key: string) => (hash(key) % 10_000) / 10_000;

/**
 * 1.2.1, after a delivery: a seasonal find (winter, Christmas), a souvenir from
 * the destination's country, now and then a treasure map — and the treasure map's
 * case when the load arrived in its city in time.
 */
export async function itemFinds(tx: Tx, f: { userId: string; deliveryId: string; destCityId: number }, at: Date) {
  if (!(await featureFor(tx, f.userId, 'item_album', at))) return [];
  const got: ItemId[] = [];
  const md = sofiaMonthDay(at);
  for (const [season, find] of [['xmas', SEASON_FIND.xmas], ['winter', SEASON_FIND.winter]] as const) {
    const window = COLLECTIONS.find((c) => c.id === season)!.season!;
    if (!inSeasonWindow(md, window) || roll(`season:${season}:${f.deliveryId}`) >= find.chance) continue;
    const item = pickFrom(find.table, roll(`season-item:${season}:${f.deliveryId}`));
    if (await grantItem(tx, f.userId, item, 1, `find:${season}`, `find-${season}:${f.deliveryId}`)) got.push(item);
  }
  const [dest] = await tx.select({ cc: cities.countryCode }).from(cities).where(eq(cities.id, f.destCityId));
  const souvenir = SOUVENIRS.find((s) => s.country === dest?.cc);
  if (souvenir && roll(`souvenir:${f.deliveryId}`) < souvenir.chance && (await grantItem(tx, f.userId, souvenir.item, 1, 'find:souvenir', `find-souvenir:${f.deliveryId}`))) got.push(souvenir.item);
  if (roll(`map:${f.deliveryId}`) < TREASURE.findChance && (await grantItem(tx, f.userId, 'treasure_map', 1, 'road_find', `find-map:${f.deliveryId}`))) got.push('treasure_map');
  // The treasure map's city reached in time.
  const [map] = await tx.select().from(itemEffects).where(and(eq(itemEffects.userId, f.userId), eq(itemEffects.effect, 'treasure'), gt(itemEffects.until, at), gt(itemEffects.uses, 0))).limit(1).for('update');
  if (map?.data?.cityId === f.destCityId) {
    const caseId: CaseId = roll(`treasure:${map.id}`) < TREASURE.goldChance ? 'case_gold' : 'case_silver';
    await tx.update(itemEffects).set({ uses: 0, until: at }).where(eq(itemEffects.id, map.id));
    if (await grantItem(tx, f.userId, caseId, 1, 'treasure', `treasure:${map.id}`)) {
      got.push(caseId);
      await notify(tx, f.userId, 'achievement', () => t('🗺 Съкровището е намерено!'), () => t('В {0} те чакаше {1}.', map.data?.cityName ?? '', ITEMS[caseId].name), '/game/inventory');
    }
  }
  if (got.length && got.some((x) => x !== 'case_silver' && x !== 'case_gold')) {
    await notify(tx, f.userId, 'success', () => t('🧳 Находка след курса: {0}', got.filter((x) => x !== 'case_silver' && x !== 'case_gold').map((x) => ITEMS[x].name).join(', ')), () => t('Виж я в „Инвентар“ и в албума.'), '/game/inventory');
  }
  return got;
}

/** The treasure map the player follows now, if any. */
export async function activeTreasure(db: DbOrTx, userId: string, now: Date) {
  const [map] = await db.select({ until: itemEffects.until, data: itemEffects.data }).from(itemEffects).where(and(eq(itemEffects.userId, userId), eq(itemEffects.effect, 'treasure'), gt(itemEffects.until, now), gt(itemEffects.uses, 0))).limit(1);
  return map?.data?.cityId ? { cityId: map.data.cityId, cityName: map.data.cityName ?? '', until: map.until! } : null;
}

// ── Weekly chest ────────────────────────────────────────────────────────

/** Deliveries this week (Sofia ISO week) and the chest they make. */
export async function weeklyChest(db: DbOrTx, userId: string, now: Date) {
  const week = periodWindow('weekly', now);
  const start = new Date(week.endsAt.getTime() - 7 * 86_400_000);
  const company = await companyForUser(db, userId);
  const [{ n = 0 } = {}] = await db.select({ n: count() }).from(deliveries).where(and(eq(deliveries.companyId, company.id), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, start), lt(deliveries.completedAt, week.endsAt)));
  const [claimed] = await db.select({ itemId: itemLog.itemId }).from(itemLog).where(eq(itemLog.idempotencyKey, `weekly-chest:${userId}:${week.key}`));
  const tier = [...WEEKLY_CHEST].reverse().find((x) => n >= x.trips) ?? null;
  const next = WEEKLY_CHEST.find((x) => n < x.trips) ?? null;
  return { week: week.key, endsAt: week.endsAt, trips: n, tier, next, claimed: (claimed?.itemId as ItemId | undefined) ?? null };
}

/** Takes the week's chest (the best tier reached so far; once a week). */
export async function claimWeeklyChest(db: Database, userId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const w = await weeklyChest(tx, userId, now);
    if (w.claimed) fail('chest_claimed', t('Сандъкът за тази седмица е взет.'));
    if (!w.tier) fail('chest_locked', t('Още {0} курса тази седмица за сандъка.', WEEKLY_CHEST[0]!.trips - w.trips));
    await grantItem(tx, userId, w.tier!.item, 1, 'weekly_chest', `weekly-chest:${userId}:${w.week}`);
    return { item: w.tier!.item };
  });
}

// ── Company chest ───────────────────────────────────────────────────────

/** Puts cases into a company's chest (once per cause), from the worker or a hook. */
export async function addToCompanyChest(tx: Tx, organizationId: string, itemId: ItemId, qty: number, reason: string, key: string, now: Date) {
  if (!featureLive('item_chests', now)) return false;
  const [logged] = await tx.insert(companyChestLog).values({ organizationId, itemId, delta: qty, reason, idempotencyKey: key }).onConflictDoNothing({ target: companyChestLog.idempotencyKey }).returning({ id: companyChestLog.id });
  if (!logged) return false;
  await tx.insert(companyChest).values({ organizationId, itemId, qty }).onConflictDoUpdate({ target: [companyChest.organizationId, companyChest.itemId], set: { qty: sql`${companyChest.qty} + ${qty}`, updatedAt: now } });
  return true;
}

/** The chest's contents and the last moves. */
export async function companyChestOf(db: DbOrTx, organizationId: string) {
  const items = await db.select({ itemId: companyChest.itemId, qty: companyChest.qty }).from(companyChest).where(and(eq(companyChest.organizationId, organizationId), gt(companyChest.qty, 0)));
  const log = await db.select({ itemId: companyChestLog.itemId, delta: companyChestLog.delta, reason: companyChestLog.reason, username: users.username, at: companyChestLog.createdAt }).from(companyChestLog).leftJoin(users, eq(users.id, companyChestLog.userId)).where(eq(companyChestLog.organizationId, organizationId)).orderBy(desc(companyChestLog.createdAt)).limit(15);
  return { items: items.filter((i) => known(i.itemId)).map((i) => ({ ...i, itemId: i.itemId as ItemId })), log: log.filter((l) => known(l.itemId)).map((l) => ({ ...l, itemId: l.itemId as ItemId })) };
}

/** The owner gives one item from the company chest to a member. */
export async function giveFromChest(db: Database, userId: string, memberId: string, itemId: string, now = new Date()) {
  if (!known(itemId)) fail('unknown_item', t('Непознат предмет.'));
  return db.transaction(async (tx) => {
    const m = await membershipOf(tx, userId, true);
    if (!m || !m.rank.isOwner) fail('forbidden', t('Само собственикът раздава от фирмения сандък.'), 403);
    const [member] = await tx.select({ userId: companyMembers.userId }).from(companyMembers).where(and(eq(companyMembers.userId, memberId), eq(companyMembers.companyId, m!.company.id)));
    if (!member) fail('not_member', t('Играчът не е в компанията.'), 404);
    const [row] = await tx.select({ qty: companyChest.qty }).from(companyChest).where(and(eq(companyChest.organizationId, m!.company.id), eq(companyChest.itemId, itemId))).for('update');
    if (!row || row.qty < 1) fail('chest_empty', t('Сандъкът няма този предмет.'));
    const key = `chest-give:${m!.company.id}:${nonce(now)}`;
    await tx.insert(companyChestLog).values({ organizationId: m!.company.id, itemId, delta: -1, reason: 'give', userId: memberId, idempotencyKey: key });
    await tx.update(companyChest).set({ qty: row!.qty - 1, updatedAt: now }).where(and(eq(companyChest.organizationId, m!.company.id), eq(companyChest.itemId, itemId)));
    await grantItem(tx, memberId, itemId as ItemId, 1, 'company_chest', key);
    await notify(tx, memberId, 'success', () => t('🧰 От фирмения сандък: {0}', ITEMS[itemId as ItemId].name), () => t('Собственикът ти даде предмет. Виж „Инвентар“.'), '/game/inventory');
    return { ok: true };
  });
}

/** Cases for a finished company project and a battle's result. */
export async function chestForProject(tx: Tx, organizationId: string, projectId: string, now: Date) {
  return addToCompanyChest(tx, organizationId, CHEST_REWARDS.project.item, CHEST_REWARDS.project.qty, 'project', `chest:project:${projectId}`, now);
}
export async function chestForBattle(tx: Tx, organizationId: string, battleId: string, won: boolean, now: Date) {
  const r = won ? CHEST_REWARDS.battleWin : CHEST_REWARDS.battleDraw;
  return addToCompanyChest(tx, organizationId, r.item, r.qty, won ? 'battle_win' : 'battle_draw', `chest:battle:${battleId}:${organizationId}`, now);
}

// ── Album, provenance, Hall of Fame ─────────────────────────────────────

/** Every item the player ever found themselves (for the album) and when it first came — presents and trades do not count (1.2.1.1). */
export async function foundItems(db: DbOrTx, userId: string) {
  const rows = await db.select({ itemId: itemLog.itemId, first: sql<Date>`min(${itemLog.createdAt})` }).from(itemLog).where(and(eq(itemLog.userId, userId), gt(itemLog.delta, 0), notInArray(itemLog.reason, RECEIVED_REASONS))).groupBy(itemLog.itemId);
  return new Map(rows.filter((r) => known(r.itemId)).map((r) => [r.itemId as ItemId, new Date(r.first)]));
}

/** Where and when the player first got an item (and the golden key's number). */
export async function provenance(db: DbOrTx, userId: string, itemIds: ItemId[]) {
  if (!itemIds.length) return {} as Partial<Record<ItemId, { reason: string; at: Date; serials?: number[] }>>;
  const rows = await db
    .selectDistinctOn([itemLog.itemId], { itemId: itemLog.itemId, reason: itemLog.reason, at: itemLog.createdAt })
    .from(itemLog)
    .where(and(eq(itemLog.userId, userId), inArray(itemLog.itemId, itemIds), gt(itemLog.delta, 0)))
    .orderBy(itemLog.itemId, asc(itemLog.createdAt));
  const out: Partial<Record<ItemId, { reason: string; at: Date; serials?: number[] }>> = {};
  for (const r of rows) if (known(r.itemId)) out[r.itemId] = { reason: r.reason, at: r.at };
  if (itemIds.includes('golden_key')) {
    const serials = await db.select({ serial: itemSerials.serial }).from(itemSerials).where(and(eq(itemSerials.itemId, 'golden_key'), eq(itemSerials.userId, userId))).orderBy(asc(itemSerials.serial));
    if (out.golden_key) out.golden_key.serials = serials.map((s) => s.serial);
  }
  return out;
}

/** „Зала на славата“: the first to finish each collection, the golden keys and the most cases opened. */
export async function hallOfFame(db: DbOrTx) {
  const collections = [];
  for (const c of COLLECTIONS) {
    const rows = await db.select({ username: users.username, userId: users.id, at: userBadges.awardedAt }).from(userBadges).innerJoin(users, eq(users.id, userBadges.userId)).where(eq(userBadges.badge, c.badge)).orderBy(asc(userBadges.awardedAt)).limit(10);
    const [{ n = 0 } = {}] = await db.select({ n: count() }).from(userBadges).where(eq(userBadges.badge, c.badge));
    collections.push({ id: c.id, name: c.name, total: n, first: rows });
  }
  const keys = await db.select({ serial: itemSerials.serial, username: users.username, userId: users.id, at: itemSerials.foundAt }).from(itemSerials).leftJoin(users, eq(users.id, itemSerials.userId)).where(eq(itemSerials.itemId, 'golden_key')).orderBy(asc(itemSerials.serial));
  const openers = await db.select({ username: users.username, userId: users.id, n: sql<number>`count(*)::int` }).from(itemLog).innerJoin(users, eq(users.id, itemLog.userId)).where(eq(itemLog.reason, 'case_open')).groupBy(users.id, users.username).orderBy(desc(sql`count(*)`)).limit(10);
  const crafters = await db.select({ username: users.username, userId: users.id, n: sql<number>`count(*)::int` }).from(itemLog).innerJoin(users, eq(users.id, itemLog.userId)).where(and(like(itemLog.reason, 'craft:%'), gt(itemLog.delta, 0))).groupBy(users.id, users.username).orderBy(desc(sql`count(*)`)).limit(10);
  return { collections, keys, openers, crafters };
}

/** 1.2.1: the menu badge — items in since the inventory was last opened (3 days back the first time), presents and offers waiting; a case to open. */
export async function inventoryBadge(db: DbOrTx, userId: string, seenAt: string | undefined, now: Date) {
  const since = seenAt ? new Date(seenAt) : new Date(now.getTime() - 3 * 86_400_000);
  const [[{ items = 0 } = {}], [{ gifts = 0 } = {}], [{ offers = 0 } = {}], [box]] = await Promise.all([
    db.select({ items: sql<number>`count(distinct ${itemLog.itemId})::int` }).from(itemLog).where(and(eq(itemLog.userId, userId), gt(itemLog.delta, 0), gt(itemLog.createdAt, since), sql`${itemLog.reason} not in ('trade_back', 'unequip')`)),
    db.select({ gifts: count() }).from(itemGifts).where(and(eq(itemGifts.toUserId, userId), isNull(itemGifts.openedAt))),
    db.select({ offers: count() }).from(itemTrades).where(and(eq(itemTrades.toUserId, userId), eq(itemTrades.status, 'open'))),
    db.select({ itemId: inventoryItems.itemId }).from(inventoryItems).where(and(eq(inventoryItems.userId, userId), gt(inventoryItems.qty, 0), inArray(inventoryItems.itemId, ['case_bronze', 'case_silver', 'case_gold']))).limit(1),
  ]);
  return { fresh: items + gifts + offers, caseReady: !!box };
}
