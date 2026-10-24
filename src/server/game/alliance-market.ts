import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { CARGO, CARGO_TYPES, type CargoType } from '@/lib/game/cargo';
import { ALLIANCE_MARKET } from '@/lib/game/community';
import { buyPriceCents, TRADE_RULES } from '@/lib/game/trade';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { allianceListings, allianceMembers, cities, companies, depots, users, warehouseStock } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { membershipOf } from './membership';
import { notify } from './notify';
import { addStock, capacityOf, usedTons } from './trade';
import { t as tr } from '@/i18n/t';

const round1 = (t: number) => Math.round(t * 10) / 10;

/** The alliance of the player's company (through the membership), or a failure. */
async function playerAllianceId(db: DbOrTx, userId: string) {
  const m = await membershipOf(db, userId);
  const [row] = m ? await db.select({ id: allianceMembers.allianceId }).from(allianceMembers).where(eq(allianceMembers.organizationId, m.company.id)) : [];
  if (!row) fail('no_alliance', tr('Компанията ти не е в съюз.'));
  return row!.id;
}

async function released(db: DbOrTx, userId: string, now: Date) {
  if (!(await featureFor(db, userId, 'alliance_market', now))) fail('not_released', tr('Това идва със следващото обновление.'), 403);
}

/** The price range per tonne for a cargo in a city (what the producers there would ask, give or take). */
export function allianceMarketRange(city: { id: number; countryCode: string }, cargo: CargoType, now: Date) {
  const base = buyPriceCents(city, cargo, now);
  return { min: Math.round(base * ALLIANCE_MARKET.minPriceShare), max: Math.round(base * ALLIANCE_MARKET.maxPriceShare), base };
}

/** Puts goods from the player's warehouse on the alliance warehouse board (they leave the warehouse until sold or withdrawn). */
export async function listForAlliance(db: Database, userId: string, input: { depotId: string; cargo: CargoType; tons: number; pricePerTonCents: number }, now = new Date()) {
  await released(db, userId, now);
  if (!CARGO_TYPES.includes(input.cargo)) fail('bad_cargo', tr('Непозната стока.'));
  const tons = round1(input.tons);
  if (!(tons >= TRADE_RULES.minTons)) fail('bad_tons', tr('Най-малко {0} т.', TRADE_RULES.minTons));
  return db.transaction(async (tx) => {
    const allianceId = await playerAllianceId(tx, userId);
    const account = await companyForUser(tx, userId);
    const [depot] = await tx.select().from(depots).where(and(eq(depots.id, input.depotId), eq(depots.companyId, account.id)));
    if (!depot) fail('depot_not_found', tr('Депото не е намерено.'), 404);
    const [{ open = 0 } = {}] = await tx.select({ open: sql<number>`count(*)::int` }).from(allianceListings).where(and(eq(allianceListings.sellerId, userId), eq(allianceListings.status, 'open')));
    if (open >= ALLIANCE_MARKET.maxListings) fail('too_many', tr('Най-много {0} обяви наведнъж.', ALLIANCE_MARKET.maxListings));
    const [city] = await tx.select({ id: cities.id, countryCode: cities.countryCode, nameBg: cities.nameBg }).from(cities).where(eq(cities.id, depot!.cityId));
    const range = allianceMarketRange(city!, input.cargo, now);
    const per = Math.round(input.pricePerTonCents);
    if (per < range.min || per > range.max) fail('bad_price', tr('Цената е между {0} и {1} лв. на тон.', Math.round(range.min / 100), Math.round(range.max / 100)));
    const [stock] = await tx.select().from(warehouseStock).where(and(eq(warehouseStock.depotId, depot!.id), eq(warehouseStock.cargoType, input.cargo))).for('update');
    if (!stock || stock.tons + 1e-6 < tons) fail('not_enough_stock', tr('В склада има {0} т.', round1(stock?.tons ?? 0)));
    const cost = Math.round((stock!.costCents * tons) / stock!.tons);
    const left = round1(stock!.tons - tons);
    if (left <= 0.05) await tx.delete(warehouseStock).where(and(eq(warehouseStock.depotId, depot!.id), eq(warehouseStock.cargoType, input.cargo)));
    else await tx.update(warehouseStock).set({ tons: left, costCents: stock!.costCents - cost, updatedAt: now }).where(and(eq(warehouseStock.depotId, depot!.id), eq(warehouseStock.cargoType, input.cargo)));
    const [row] = await tx
      .insert(allianceListings)
      .values({ allianceId, sellerId: userId, depotId: depot!.id, cityId: depot!.cityId, cargoType: input.cargo, tons, costCents: cost, priceCents: Math.round(per * tons), expiresAt: new Date(now.getTime() + ALLIANCE_MARKET.hours * 3_600_000), createdAt: now })
      .returning();
    return row!;
  });
}

/** Back into the seller's warehouse (as much as fits; the rest is lost only if the warehouse shrank — it never does). */
async function returnGoods(tx: Tx, l: typeof allianceListings.$inferSelect) {
  await addStock(tx, l.depotId, l.cargoType as CargoType, l.tons, l.costCents);
}

export async function withdrawAllianceListing(db: Database, userId: string, listingId: string) {
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(allianceListings).where(and(eq(allianceListings.id, listingId), eq(allianceListings.sellerId, userId), eq(allianceListings.status, 'open'))).for('update');
    if (!l) fail('not_found', tr('Обявата не е намерена.'), 404);
    await tx.update(allianceListings).set({ status: 'withdrawn' }).where(eq(allianceListings.id, l!.id));
    await returnGoods(tx, l!);
  });
}

/** A member of another company in the alliance buys the goods into their own warehouse in the same city. */
export async function buyAllianceListing(db: Database, userId: string, listingId: string, now = new Date()) {
  await released(db, userId, now);
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(allianceListings).where(eq(allianceListings.id, listingId)).for('update');
    if (!l || l.status !== 'open' || l.expiresAt <= now) fail('not_found', tr('Обявата вече не е активна.'), 404);
    if (l!.sellerId === userId) fail('own', tr('Това е твоята обява.'));
    if ((await playerAllianceId(tx, userId)) !== l!.allianceId) fail('other_alliance', tr('Обявата е за друг съюз.'), 403);
    const buyer = await companyForUser(tx, userId);
    const [depot] = await tx.select().from(depots).where(and(eq(depots.companyId, buyer.id), eq(depots.cityId, l!.cityId))).for('update');
    if (!depot) fail('no_depot', tr('Нужно ти е депо в този град — стоката остава в склада там.'));
    const free = (await capacityOf(tx, depot!)) - (await usedTons(tx, depot!.id));
    if (l!.tons > free + 1e-6) fail('warehouse_full', tr('В склада ти има място за {0} т.', round1(Math.max(0, free))));
    const [seller] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, l!.sellerId));
    if (!seller) fail('not_found', tr('Продавачът вече го няма.'), 404);
    const [names] = await tx.select({ city: cities.nameBg }).from(cities).where(eq(cities.id, l!.cityId));
    const [buyerName] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
    const what = tr('{0} т {1} в {2}', l!.tons, CARGO[l!.cargoType as CargoType].label.toLowerCase(), names!.city);
    const buy = [{ category: 'alliance_market' as const, amountCents: -l!.priceCents, description: tr('Склад на съюза: {0}', what), idempotencyKey: `alliance-market:${l!.id}:buy`, refType: 'alliance_listing', refId: l!.id }];
    const sell = [{ category: 'alliance_market' as const, amountCents: l!.priceCents, description: tr('Склад на съюза: продадени {0}', what), idempotencyKey: `alliance-market:${l!.id}:sell`, refType: 'alliance_listing', refId: l!.id }];
    // Lock both accounts in a fixed order so two crossing purchases cannot deadlock.
    if (buyer.id < seller!.id) {
      await post(tx, buyer.id, buy, { requireFunds: true });
      await post(tx, seller!.id, sell);
    } else {
      await post(tx, seller!.id, sell);
      await post(tx, buyer.id, buy, { requireFunds: true });
    }
    // The buyer pays the seller's price; that is what the goods cost them now.
    await addStock(tx, depot!.id, l!.cargoType as CargoType, l!.tons, l!.priceCents);
    await tx.update(allianceListings).set({ status: 'sold', buyerId: userId }).where(eq(allianceListings.id, l!.id));
    await notify(tx, l!.sellerId, 'success', () => tr('Продадено в склада на съюза'), () => tr('{0} купи {1}.', buyerName!.username, what), '/game/company/alliance');
    return { priceCents: l!.priceCents };
  });
}

/** Worker: listings nobody bought go back to the seller's warehouse. */
export async function expireAllianceListings(db: Database, now = new Date()) {
  const due = await db.select({ id: allianceListings.id }).from(allianceListings).where(and(eq(allianceListings.status, 'open'), lte(allianceListings.expiresAt, now))).limit(100);
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [l] = await tx.select().from(allianceListings).where(and(eq(allianceListings.id, id), eq(allianceListings.status, 'open'))).for('update');
      if (!l) return;
      await tx.update(allianceListings).set({ status: 'expired' }).where(eq(allianceListings.id, l.id));
      await returnGoods(tx, l);
      await notify(tx, l.sellerId, 'info', () => tr('Обявата в склада на съюза изтече'), () => tr('Стоката се върна в склада ти.'), '/game/trade');
    });
  }
  return due.length;
}

/** The open listings of the player's alliance and the player's own depots (where they can sell from or buy into). */
export async function allianceMarketView(db: DbOrTx, userId: string, now = new Date()) {
  const m = await membershipOf(db, userId);
  const [row] = m ? await db.select({ id: allianceMembers.allianceId }).from(allianceMembers).where(eq(allianceMembers.organizationId, m.company.id)) : [];
  if (!row) return null;
  const listings = await db
    .select({ id: allianceListings.id, sellerId: allianceListings.sellerId, seller: users.username, cityId: allianceListings.cityId, city: cities.nameBg, cargoType: allianceListings.cargoType, tons: allianceListings.tons, priceCents: allianceListings.priceCents, expiresAt: allianceListings.expiresAt })
    .from(allianceListings)
    .innerJoin(users, eq(users.id, allianceListings.sellerId))
    .innerJoin(cities, eq(cities.id, allianceListings.cityId))
    .where(and(eq(allianceListings.allianceId, row.id), eq(allianceListings.status, 'open'), sql`${allianceListings.expiresAt} > ${now}`))
    .orderBy(asc(allianceListings.expiresAt));
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  const myDepots = account ? await db.select({ id: depots.id, cityId: depots.cityId, city: cities.nameBg, countryCode: cities.countryCode }).from(depots).innerJoin(cities, eq(cities.id, depots.cityId)).where(eq(depots.companyId, account.id)) : [];
  const stock = myDepots.length ? await db.select().from(warehouseStock).where(inArray(warehouseStock.depotId, myDepots.map((d) => d.id))) : [];
  return {
    listings: listings.map((l) => ({ ...l, mine: l.sellerId === userId, canBuy: l.sellerId !== userId && myDepots.some((d) => d.cityId === l.cityId) })),
    stock: stock.map((s) => {
      const d = myDepots.find((x) => x.id === s.depotId)!;
      return { depotId: s.depotId, city: d.city, cityId: d.cityId, cargoType: s.cargoType, tons: round1(s.tons), range: allianceMarketRange({ id: d.cityId, countryCode: d.countryCode }, s.cargoType as CargoType, now) };
    }),
  };
}
