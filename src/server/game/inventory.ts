import { randomInt } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { drivers, inventoryItems, itemEffects, itemLog, userBadges, users, vehicles } from '@/server/db/schema';
import { CASE_TABLES, COLLECTION, ITEMS, ITEM_RULES, ROAD_FIND, coinsOf, isCase, pickFrom, type CaseId, type ItemId } from '@/lib/game/items';
import { hash } from '@/lib/game/missions';
import { t } from '@/i18n/t';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';

/**
 * 1.2 „Инвентар“. Items move only through `grantItem` / `takeItem`, each with a
 * unique key (like money through `post()`), so a repeated cause never gives
 * twice. Cases are opened on the server with a crypto random number.
 */
const known = (id: string): id is ItemId => id in ITEMS;

export async function grantItem(tx: Tx, userId: string, itemId: ItemId, qty: number, reason: string, key: string) {
  if (!known(itemId) || qty <= 0 || ITEMS[itemId].kind === 'coins') throw new Error(`bad item ${itemId}`);
  const [logged] = await tx.insert(itemLog).values({ userId, itemId, delta: qty, reason, idempotencyKey: key }).onConflictDoNothing({ target: itemLog.idempotencyKey }).returning({ id: itemLog.id });
  if (!logged) return false;
  await tx.insert(inventoryItems).values({ userId, itemId, qty }).onConflictDoUpdate({ target: [inventoryItems.userId, inventoryItems.itemId], set: { qty: sql`${inventoryItems.qty} + ${qty}`, updatedAt: new Date() } });
  if (ITEMS[itemId].kind === 'collectible') await checkCollection(tx, userId);
  return true;
}

async function takeItem(tx: Tx, userId: string, itemId: ItemId, reason: string, key: string) {
  const [row] = await tx.select({ qty: inventoryItems.qty }).from(inventoryItems).where(and(eq(inventoryItems.userId, userId), eq(inventoryItems.itemId, itemId))).for('update');
  if (!row || row.qty < 1) fail('no_item', t('Нямаш този предмет.'));
  await tx.insert(itemLog).values({ userId, itemId, delta: -1, reason, idempotencyKey: key });
  await tx.update(inventoryItems).set({ qty: row!.qty - 1, updatedAt: new Date() }).where(and(eq(inventoryItems.userId, userId), eq(inventoryItems.itemId, itemId)));
}

/** All four „Спомени от пътя“ ever found: the badge and ТрансКоин, once. */
async function checkCollection(tx: Tx, userId: string) {
  const found = await tx.selectDistinct({ itemId: itemLog.itemId }).from(itemLog).where(and(eq(itemLog.userId, userId), inArray(itemLog.itemId, COLLECTION.items), gt(itemLog.delta, 0)));
  if (found.length < COLLECTION.items.length) return false;
  const paid = await postCoins(tx, userId, { amount: COLLECTION.coins, reason: 'items', description: t('Колекция „Спомени от пътя“'), idempotencyKey: `collection:${userId}` });
  if (paid) {
    await tx.insert(userBadges).values({ userId, badge: COLLECTION.badge, awardedAt: new Date() }).onConflictDoNothing();
    await notify(tx, userId, 'achievement', () => t('🧳 Колекцията е пълна!'), () => t('„Спомени от пътя“ — +{0} ТрансКоин и значка.', COLLECTION.coins), '/game/inventory');
  }
  return paid;
}

export async function inventoryOf(db: DbOrTx, userId: string) {
  return db.select({ itemId: inventoryItems.itemId, qty: inventoryItems.qty }).from(inventoryItems).where(and(eq(inventoryItems.userId, userId), gt(inventoryItems.qty, 0)));
}

export async function recentItems(db: DbOrTx, userId: string, limit = 12) {
  return db.select({ itemId: itemLog.itemId, delta: itemLog.delta, reason: itemLog.reason, at: itemLog.createdAt }).from(itemLog).where(eq(itemLog.userId, userId)).orderBy(desc(itemLog.createdAt)).limit(limit);
}

export async function activeEffects(db: DbOrTx, userId: string, now = new Date()) {
  return db.select().from(itemEffects).where(and(eq(itemEffects.userId, userId), or(gt(itemEffects.until, now), and(isNull(itemEffects.until), gt(itemEffects.uses, 0)))));
}

/** Opens a case: one item from its table (crypto random), the case goes. */
export async function openCase(db: Database, userId: string, caseId: CaseId, now = new Date(), rand: () => number = () => randomInt(0, 1_000_000) / 1_000_000) {
  if (!known(caseId) || !isCase(caseId)) fail('not_a_case', t('Това не е кейс.'));
  return db.transaction(async (tx) => {
    const nonce = `${now.getTime()}:${randomInt(0, 1e9)}`;
    await takeItem(tx, userId, caseId, 'case_open', `open:${userId}:${caseId}:${nonce}`);
    const item = pickFrom(CASE_TABLES[caseId], rand());
    const coins = coinsOf(item);
    if (coins) {
      // ТрансКоин from a case go straight to the wallet; the log keeps the drop.
      await postCoins(tx, userId, { amount: coins, reason: 'items', description: t('{0} от {1}', ITEMS[item].name, ITEMS[caseId].name), idempotencyKey: `case-coins:${userId}:${caseId}:${nonce}` });
      await tx.insert(itemLog).values({ userId, itemId: item, delta: 1, reason: `case:${caseId}`, idempotencyKey: `from-case:${userId}:${caseId}:${nonce}` });
      return { item, coins };
    }
    await grantItem(tx, userId, item, 1, `case:${caseId}`, `from-case:${userId}:${caseId}:${nonce}`);
    return { item, coins: 0 };
  });
}

async function ownDriver(tx: Tx, companyId: string, driverId: string | undefined) {
  if (!driverId) fail('need_driver', t('Избери шофьор.'));
  const [d] = await tx.select().from(drivers).where(and(eq(drivers.id, driverId!), eq(drivers.companyId, companyId))).for('update');
  if (!d) fail('driver_not_found', t('Шофьорът не е намерен.'), 404);
  return d!;
}

/** Uses one item (on a driver or a truck when it needs one). Returns a short result line. */
export async function applyItem(db: Database, userId: string, itemId: string, target: { driverId?: string; vehicleId?: string }, now = new Date()) {
  if (!known(itemId)) fail('unknown_item', t('Непознат предмет.'));
  const def = ITEMS[itemId as ItemId];
  if (def.kind === 'case') fail('open_case', t('Кейсът се отваря, не се използва.'));
  if (def.kind === 'collectible') fail('collectible', t('Този предмет е за колекцията.'));
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    let result = '';
    switch (itemId as ItemId) {
      case 'coffee': {
        const d = await ownDriver(tx, company.id, target.driverId);
        if (!d.restedAt || d.restedAt <= now) fail('not_resting', t('{0} не почива сега.', d.name));
        await tx.update(drivers).set({ restedAt: new Date(now.getTime() + (d.restedAt!.getTime() - now.getTime()) / 2) }).where(eq(drivers.id, d.id));
        result = t('{0} почива наполовина по-кратко.', d.name);
        break;
      }
      case 'energy_drink': {
        const d = await ownDriver(tx, company.id, target.driverId);
        if ((!d.restedAt || d.restedAt <= now) && d.dutyMin <= 0) fail('not_resting', t('{0} вече е отпочинал.', d.name));
        await tx.update(drivers).set({ restedAt: now, dutyMin: 0 }).where(eq(drivers.id, d.id));
        result = t('{0} е отпочинал.', d.name);
        break;
      }
      case 'thermos': {
        const resting = await tx.select().from(drivers).where(and(eq(drivers.companyId, company.id), gt(drivers.restedAt, now)));
        if (!resting.length) fail('not_resting', t('Никой шофьор не почива сега.'));
        for (const d of resting) await tx.update(drivers).set({ restedAt: new Date(now.getTime() + (d.restedAt!.getTime() - now.getTime()) / 2) }).where(eq(drivers.id, d.id));
        result = t('{0} шофьори почиват наполовина по-кратко.', resting.length);
        break;
      }
      case 'cab_coffee':
      case 'power_nap': {
        const d = await ownDriver(tx, company.id, target.driverId);
        const hours = itemId === 'cab_coffee' ? ITEM_RULES.cabCoffeeHours : ITEM_RULES.powerNapHours;
        await tx.update(drivers).set({ restedAt: now, dutyMin: 0 }).where(eq(drivers.id, d.id));
        await tx.insert(itemEffects).values({ userId, driverId: d.id, effect: 'no_rest', until: new Date(now.getTime() + hours * 3_600_000) });
        result = t('{0} не спира за почивка {1} часа.', d.name, hours);
        break;
      }
      case 'repair_kit': {
        if (!target.vehicleId) fail('need_vehicle', t('Избери камион.'));
        const [v] = await tx.select({ condition: vehicles.condition, plate: vehicles.plate }).from(vehicles).where(and(eq(vehicles.id, target.vehicleId!), eq(vehicles.companyId, company.id)));
        if (!v) fail('vehicle_not_found', t('Превозното средство не е намерено.'), 404);
        if (v!.condition >= 100) fail('full_condition', t('Камионът е в отлично състояние.'));
        await tx.update(vehicles).set({ condition: sql`least(100, ${vehicles.condition} + ${ITEM_RULES.repairPoints})` }).where(eq(vehicles.id, target.vehicleId!));
        result = t('{0}: +{1}% състояние.', v!.plate, ITEM_RULES.repairPoints);
        break;
      }
      case 'fuel_voucher':
        await post(tx, company.id, [{ category: 'items', amountCents: ITEM_RULES.fuelVoucherCents, description: t('Ваучер за гориво'), idempotencyKey: `item-fuel:${userId}:${now.getTime()}:${randomInt(0, 1e9)}` }]);
        result = t('+{0} лв. по сметката.', ITEM_RULES.fuelVoucherCents / 100);
        break;
      case 'cargo_cover':
        await tx.insert(itemEffects).values({ userId, effect: 'cover_late', uses: 1 });
        result = t('Следващата неустойка за закъснение е покрита.');
        break;
      case 'queue_ticket':
        await tx.insert(itemEffects).values({ userId, effect: 'queue_extra', until: new Date(now.getTime() + ITEM_RULES.queueHours * 3_600_000) });
        result = t('+{0} места в опашката за 24 часа.', ITEM_RULES.queueExtra);
        break;
      case 'driver_handbook': {
        const [u] = await tx.select({ until: users.xpBoostUntil }).from(users).where(eq(users.id, userId));
        const from = u?.until && u.until > now ? u.until : now;
        await tx.update(users).set({ xpBoostUntil: new Date(from.getTime() + ITEM_RULES.handbookHours * 3_600_000) }).where(eq(users.id, userId));
        result = t('Двоен опит още 1 час.');
        break;
      }
      case 'coin_pouch':
        await postCoins(tx, userId, { amount: ITEM_RULES.coinPouch, reason: 'items', description: t('Кесия с ТрансКоин'), idempotencyKey: `item-coins:${userId}:${now.getTime()}:${randomInt(0, 1e9)}` });
        result = t('+{0} ТрансКоин.', ITEM_RULES.coinPouch);
        break;
      case 'trucker_cap':
      case 'sunglasses':
      case 'gold_frame': {
        const d = await ownDriver(tx, company.id, target.driverId);
        const look = { ...(d.look ?? {}) };
        if (itemId === 'trucker_cap') {
          if (look.cap) fail('has_look', t('{0} вече носи шапка.', d.name));
          look.cap = true;
        } else if (itemId === 'sunglasses') {
          if (look.glasses) fail('has_look', t('{0} вече носи очила.', d.name));
          look.glasses = true;
        } else {
          if (look.frame) fail('has_look', t('{0} вече има рамка.', d.name));
          look.frame = 'gold';
        }
        await tx.update(drivers).set({ look }).where(eq(drivers.id, d.id));
        result = t('{0} има нов вид.', d.name);
        break;
      }
      default:
        fail('not_usable', t('Този предмет не се използва.'));
    }
    await takeItem(tx, userId, itemId as ItemId, `use:${itemId}`, `use:${userId}:${itemId}:${now.getTime()}:${randomInt(0, 1e9)}`);
    return { result };
  });
}

// ── Hooks in the rest of the game ───────────────────────────────────────

/** After a trip: drivers under „no rest“ are rested at once. */
export async function applyNoRest(tx: Tx, userId: string, crew: readonly string[], at: Date) {
  if (!crew.length) return 0;
  const active = await tx.select({ driverId: itemEffects.driverId }).from(itemEffects).where(and(eq(itemEffects.userId, userId), eq(itemEffects.effect, 'no_rest'), gt(itemEffects.until, at), inArray(itemEffects.driverId, [...crew])));
  const ids = active.map((a) => a.driverId).filter((x): x is string => !!x);
  if (ids.length) await tx.update(drivers).set({ restedAt: at, dutyMin: 0 }).where(inArray(drivers.id, ids));
  return ids.length;
}

/** A late penalty covered by „Застраховка за един курс“ (uses the item's charge). */
export async function coverLate(tx: Tx, userId: string) {
  const [e] = await tx.select().from(itemEffects).where(and(eq(itemEffects.userId, userId), eq(itemEffects.effect, 'cover_late'), gt(itemEffects.uses, 0))).limit(1).for('update');
  if (!e) return false;
  await tx.update(itemEffects).set({ uses: e.uses! - 1 }).where(eq(itemEffects.id, e.id));
  return true;
}

export async function queueExtra(db: DbOrTx, userId: string, now: Date) {
  const [e] = await db.select({ id: itemEffects.id }).from(itemEffects).where(and(eq(itemEffects.userId, userId), eq(itemEffects.effect, 'queue_extra'), gt(itemEffects.until, now))).limit(1);
  return e ? ITEM_RULES.queueExtra : 0;
}

// ── Where items come from ───────────────────────────────────────────────

/** A case as a reward (gated by the feature). */
export async function rewardCase(tx: Tx, userId: string, caseId: CaseId, reason: string, key: string, now: Date) {
  if (!(await featureFor(tx, userId, 'inventory', now))) return false;
  const given = await grantItem(tx, userId, caseId, 1, reason, key);
  if (given) await notify(tx, userId, 'success', () => t('🎁 Нов предмет: {0}', ITEMS[caseId].name), () => t('Отвори го от „Инвентар“.'), '/game/inventory');
  return given;
}

/** After a delivery: now and then a find on the road. */
export async function roadFind(tx: Tx, userId: string, deliveryId: string, now: Date) {
  if ((hash(`find:${deliveryId}`) % 10_000) / 10_000 >= ROAD_FIND.chance) return null;
  if (!(await featureFor(tx, userId, 'inventory', now))) return null;
  const item = pickFrom(ROAD_FIND.table, (hash(`find-item:${deliveryId}`) % 10_000) / 10_000);
  if (await grantItem(tx, userId, item, 1, 'road_find', `find:${deliveryId}`)) {
    await notify(tx, userId, 'success', () => t('🧳 Находка по пътя: {0}', ITEMS[item].name), () => t('Шофьорът го намери на паркинга. Виж „Инвентар“.'), '/game/inventory');
    return item;
  }
  return null;
}

/** Daily reward: day 7 of the cycle — a silver case; otherwise a chance of a bronze one. */
export async function dailyCase(tx: Tx, userId: string, cycleDay: number, day: string, now: Date, r: number = randomInt(0, 1_000_000) / 1_000_000) {
  if (cycleDay === 7) return rewardCase(tx, userId, 'case_silver', 'daily', `daily-case:${userId}:${day}`, now);
  if (r < ITEM_RULES.dailyBronzeChance) return rewardCase(tx, userId, 'case_bronze', 'daily', `daily-case:${userId}:${day}`, now);
  return false;
}
