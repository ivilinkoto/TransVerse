import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { CARGO, CARGO_TYPES, type CargoType } from '@/lib/game/cargo';
import { contractWindowMinutes } from '@/lib/game/schedule';
import { TRADE_RULES, buyPriceCents, sellPriceCents, warehouseCapacityTons } from '@/lib/game/trade';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, cityMarkets, companies, contracts, depots, haulerRatings, users, warehouseStock } from '@/server/db/schema';
import { rewardCents } from '@/lib/game/economy';
import { featureFor } from '@/server/features';
import { bonusesForUser } from './membership';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { companyForUser } from './company';
import { acceptContract } from './deliveries';
import { fail } from './errors';
import { post } from './finance';
import { broadcast, logActivity, notify } from './notify';

const round1 = (t: number) => Math.round(t * 10) / 10;
const eur = (c: number) => `${Math.round(c / 100).toLocaleString('bg-BG')} лв.`;

async function ownDepot(db: DbOrTx, companyId: string, depotId: string, lock = false) {
  const q = db.select().from(depots).where(and(eq(depots.id, depotId), eq(depots.companyId, companyId)));
  const [d] = lock ? await q.for('update') : await q;
  if (!d) fail('depot_not_found', 'Депото не е намерено.', 404);
  return d!;
}

/** Extra warehouse tonnes the account has in a city: the warehouse on its company's plot counts in the base city. */
async function plotWarehouseTons(db: DbOrTx, companyId: string): Promise<{ cityId: number; tons: number } | null> {
  const [owner] = await db.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, companyId));
  const perks = owner ? await bonusesForUser(db, owner.ownerId) : null;
  return perks?.bonuses.warehouseTons ? { cityId: perks.membership.company.hqCityId, tons: perks.bonuses.warehouseTons } : null;
}

export async function capacityOf(db: DbOrTx, depot: { companyId: string; cityId: number; slots: number }) {
  const extra = await plotWarehouseTons(db, depot.companyId);
  return warehouseCapacityTons(depot.slots) + (extra?.cityId === depot.cityId ? extra.tons : 0);
}

export async function usedTons(db: DbOrTx, depotId: string) {
  const [{ t = 0 } = {}] = await db.select({ t: sql<number>`coalesce(sum(${warehouseStock.tons}), 0)::float` }).from(warehouseStock).where(eq(warehouseStock.depotId, depotId));
  return Number(t);
}

async function market(db: DbOrTx, cityId: number, cargo: CargoType) {
  const [m] = await db.select().from(cityMarkets).where(and(eq(cityMarkets.cityId, cityId), eq(cityMarkets.cargoType, cargo)));
  return m ?? null;
}

export async function addStock(tx: DbOrTx, depotId: string, cargo: CargoType, tons: number, costCents: number) {
  await tx
    .insert(warehouseStock)
    .values({ depotId, cargoType: cargo, tons, costCents })
    .onConflictDoUpdate({ target: [warehouseStock.depotId, warehouseStock.cargoType], set: { tons: sql`${warehouseStock.tons} + ${tons}`, costCents: sql`${warehouseStock.costCents} + ${costCents}`, updatedAt: new Date() } });
}

/** Buys goods from the producers of the depot's city into its warehouse. */
export async function buyGoods(db: Database, userId: string, input: { depotId: string; cargo: CargoType; tons: number }, now = new Date()) {
  const tons = round1(input.tons);
  if (!(tons >= TRADE_RULES.minTons)) fail('bad_tons', `Най-малко ${TRADE_RULES.minTons} т.`);
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const depot = await ownDepot(tx, company.id, input.depotId, true);
    const m = await market(tx, depot.cityId, input.cargo);
    if (!m?.produces) fail('not_produced', 'Тази стока не се произвежда в града на депото.');
    const free = (await capacityOf(tx, depot)) - (await usedTons(tx, depot.id));
    if (tons > free + 1e-6) fail('warehouse_full', `В склада има място за ${round1(Math.max(0, free))} т.`);
    const [city] = await tx.select({ id: cities.id, countryCode: cities.countryCode, nameBg: cities.nameBg }).from(cities).where(eq(cities.id, depot.cityId));
    const cost = Math.round(buyPriceCents(city!, input.cargo, now) * tons);
    await post(tx, company.id, [{ category: 'trade_purchase', amountCents: -cost, description: `Покупка: ${tons} т ${CARGO[input.cargo].label.toLowerCase()} в ${city!.nameBg}`, idempotencyKey: `trade:buy:${randomUUID()}` }], { requireFunds: true });
    await addStock(tx, depot.id, input.cargo, tons, cost);
    await logActivity(tx, userId, 'trade_buy', { depotId: depot.id, cargo: input.cargo, tons, cost });
    return cost;
  });
}

/**
 * Loads goods from a warehouse onto one of the player's vehicles and sends it:
 * to be sold at the destination market, or stored in the player's depot there.
 */
export async function shipGoods(
  db: Database,
  userId: string,
  input: { depotId: string; cargo: CargoType; tons: number; destCityId: number; vehicleId: string; mode: 'sell' | 'store' },
  now = new Date(),
  provider?: RoutingProvider,
) {
  const tons = round1(input.tons);
  if (!(tons >= TRADE_RULES.minTons)) fail('bad_tons', `Най-малко ${TRADE_RULES.minTons} т.`);
  const company = await companyForUser(db, userId);
  const depot = await ownDepot(db, company.id, input.depotId);
  if (input.destCityId === depot.cityId) fail('same_city', 'Избери друг град.');
  let destDepotId: string | null = null;
  if (input.mode === 'sell') {
    const m = await market(db, input.destCityId, input.cargo);
    if (!m?.consumes) fail('not_consumed', 'В този град няма купувачи на тази стока.');
  } else {
    const [dest] = await db.select().from(depots).where(and(eq(depots.companyId, company.id), eq(depots.cityId, input.destCityId)));
    if (!dest) fail('no_depot', 'Нямаш депо в този град.');
    if (tons > (await capacityOf(db, dest!)) - (await usedTons(db, dest!.id)) + 1e-6) fail('warehouse_full', 'Складът в този град няма толкова място.');
    destDepotId = dest!.id;
  }
  const route = await getRoute(db, depot.cityId, input.destCityId, 'truck', provider);
  // Take the goods out of the warehouse and create the private shipment in one step.
  const contractId = await db.transaction(async (tx) => {
    const [stock] = await tx.select().from(warehouseStock).where(and(eq(warehouseStock.depotId, depot.id), eq(warehouseStock.cargoType, input.cargo))).for('update');
    if (!stock || stock.tons + 1e-6 < tons) fail('not_enough_stock', `В склада има ${round1(stock?.tons ?? 0)} т.`);
    const cost = Math.round((stock!.costCents * tons) / stock!.tons);
    const left = round1(stock!.tons - tons);
    if (left <= 0.05) await tx.delete(warehouseStock).where(and(eq(warehouseStock.depotId, depot.id), eq(warehouseStock.cargoType, input.cargo)));
    else await tx.update(warehouseStock).set({ tons: left, costCents: stock!.costCents - cost, updatedAt: now }).where(and(eq(warehouseStock.depotId, depot.id), eq(warehouseStock.cargoType, input.cargo)));
    const [row] = await tx
      .insert(contracts)
      .values({
        shipper: 'Собствена стока',
        goods: CARGO[input.cargo].goods[0]!,
        cargoType: input.cargo,
        weightTons: tons,
        originCityId: depot.cityId,
        destCityId: input.destCityId,
        routeId: route.id,
        distanceKm: route.distanceKm,
        rewardCents: 0,
        windowMinutes: contractWindowMinutes(route.distanceKm),
        minLevel: 1,
        status: 'trade',
        tradeCompanyId: company.id,
        trade: { mode: input.mode, tons, costCents: cost, destDepotId },
        expiresAt: new Date(now.getTime() + 3_600_000),
      })
      .returning({ id: contracts.id });
    return row!.id;
  });
  try {
    return await acceptContract(db, userId, contractId, input.vehicleId, now);
  } catch (error) {
    // The truck could not go: the goods go back to the warehouse.
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(contracts).where(and(eq(contracts.id, contractId), eq(contracts.status, 'trade'))).for('update');
      if (!c?.trade) return;
      await addStock(tx, depot.id, input.cargo, c.trade.tons, c.trade.costCents);
      await tx.delete(contracts).where(eq(contracts.id, contractId));
    });
    throw error;
  }
}

// ── Freight exchange (v1.4) ─────────────────────────────────────────────

export const EXCHANGE = { minPriceShare: 0.6, maxPriceShare: 3, hours: 24 } as const;

/** A fair price for hauling a lot (what an NPC shipper would pay). */
export const exchangeSuggestedCents = (cargo: CargoType, tons: number, km: number) => rewardCents(cargo, tons, km, 1);

/**
 * Puts own goods on the board for other players to haul (the freight
 * exchange): the goods leave the warehouse, the pay the owner sets is taken
 * into escrow now and goes to the hauler on delivery; nobody takes it in a
 * day → goods and money come back.
 */
export async function postFreight(db: Database, userId: string, input: { depotId: string; cargo: CargoType; tons: number; destCityId: number; mode: 'sell' | 'store'; priceCents: number }, now = new Date(), provider?: RoutingProvider) {
  if (!(await featureFor(db, userId, 'freight_exchange', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  const tons = round1(input.tons);
  if (!(tons >= TRADE_RULES.minTons)) fail('bad_tons', `Най-малко ${TRADE_RULES.minTons} т.`);
  const company = await companyForUser(db, userId);
  const depot = await ownDepot(db, company.id, input.depotId);
  if (input.destCityId === depot.cityId) fail('same_city', 'Избери друг град.');
  let destDepotId: string | null = null;
  if (input.mode === 'sell') {
    const m = await market(db, input.destCityId, input.cargo);
    if (!m?.consumes) fail('not_consumed', 'В този град няма купувачи на тази стока.');
  } else {
    const [dest] = await db.select().from(depots).where(and(eq(depots.companyId, company.id), eq(depots.cityId, input.destCityId)));
    if (!dest) fail('no_depot', 'Нямаш депо в този град.');
    destDepotId = dest!.id;
  }
  const route = await getRoute(db, depot.cityId, input.destCityId, 'truck', provider);
  const fair = exchangeSuggestedCents(input.cargo, tons, route.distanceKm);
  if (input.priceCents < fair * EXCHANGE.minPriceShare || input.priceCents > fair * EXCHANGE.maxPriceShare) fail('bad_price', `Заплащането трябва да е между ${eur(fair * EXCHANGE.minPriceShare)} и ${eur(fair * EXCHANGE.maxPriceShare)}.`);
  return db.transaction(async (tx) => {
    const [stock] = await tx.select().from(warehouseStock).where(and(eq(warehouseStock.depotId, depot.id), eq(warehouseStock.cargoType, input.cargo))).for('update');
    if (!stock || stock.tons + 1e-6 < tons) fail('not_enough_stock', `В склада има ${round1(stock?.tons ?? 0)} т.`);
    const cost = Math.round((stock!.costCents * tons) / stock!.tons);
    const left = round1(stock!.tons - tons);
    if (left <= 0.05) await tx.delete(warehouseStock).where(and(eq(warehouseStock.depotId, depot.id), eq(warehouseStock.cargoType, input.cargo)));
    else await tx.update(warehouseStock).set({ tons: left, costCents: stock!.costCents - cost, updatedAt: now }).where(and(eq(warehouseStock.depotId, depot.id), eq(warehouseStock.cargoType, input.cargo)));
    const [row] = await tx
      .insert(contracts)
      .values({
        shipper: `Борса · ${(await tx.select({ username: users.username }).from(users).where(eq(users.id, userId)))[0]!.username}`.slice(0, 60),
        goods: CARGO[input.cargo].goods[0]!, cargoType: input.cargo, weightTons: tons,
        originCityId: depot.cityId, destCityId: input.destCityId, routeId: route.id, distanceKm: route.distanceKm,
        rewardCents: input.priceCents, windowMinutes: contractWindowMinutes(route.distanceKm), minLevel: 1,
        status: 'open', tradeCompanyId: company.id, exchange: true,
        trade: { mode: input.mode, tons, costCents: cost, destDepotId, fromDepotId: depot.id, escrowCents: input.priceCents },
        expiresAt: new Date(now.getTime() + EXCHANGE.hours * 3_600_000),
      })
      .returning({ id: contracts.id });
    await post(tx, company.id, [{ category: 'freight_escrow', amountCents: -input.priceCents, description: `Депозит за превоз: ${tons} т ${CARGO[input.cargo].label.toLowerCase()}`, idempotencyKey: `exchange:${row!.id}:escrow`, refType: 'contract', refId: row!.id }], { requireFunds: true });
    await logActivity(tx, userId, 'freight_posted', { contractId: row!.id, priceCents: input.priceCents });
    await broadcast(tx, 'market');
    return row!.id;
  });
}

/** Worker: offers nobody took in time — the goods go back to the warehouse, the escrow to the owner. */
export async function expireFreight(db: Database, now = new Date()) {
  const due = await db.select({ id: contracts.id }).from(contracts).where(and(eq(contracts.exchange, true), inArray(contracts.status, ['open', 'expired']), sql`${contracts.expiresAt} <= ${now}`)).limit(100);
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(contracts).where(and(eq(contracts.id, id), inArray(contracts.status, ['open', 'expired']))).for('update');
      if (!c?.trade || !c.tradeCompanyId) return;
      await tx.update(contracts).set({ status: 'returned' }).where(eq(contracts.id, c.id));
      const [from] = c.trade.fromDepotId ? await tx.select().from(depots).where(eq(depots.id, c.trade.fromDepotId)) : [];
      if (from) await addStock(tx, from.id, c.cargoType as CargoType, c.trade.tons, c.trade.costCents);
      await post(tx, c.tradeCompanyId, [{ category: 'freight_escrow', amountCents: c.trade.escrowCents ?? c.rewardCents, description: 'Върнат депозит: никой не пое превоза', idempotencyKey: `exchange:${c.id}:refund`, refType: 'contract', refId: c.id }]);
      const [owner] = await tx.select({ id: companies.ownerId }).from(companies).where(eq(companies.id, c.tradeCompanyId));
      if (owner) await notify(tx, owner.id, 'info', 'Никой не пое превоза', `${c.trade.tons} т ${c.goods} са обратно в склада, а депозитът — в сметката ти.`, '/game/trade');
    });
  }
  return due.length;
}

/** On delivery of an exchange load: a late penalty goes back to the owner; the owner may rate the hauler. */
export async function settleExchange(tx: Tx, contract: typeof contracts.$inferSelect, haulerUserId: string, penaltyCents: number) {
  if (!contract.exchange || !contract.tradeCompanyId) return;
  const [owner] = await tx.select({ id: companies.ownerId }).from(companies).where(eq(companies.id, contract.tradeCompanyId));
  if (!owner) return;
  if (penaltyCents > 0) await post(tx, contract.tradeCompanyId, [{ category: 'freight_escrow', amountCents: penaltyCents, description: 'Неустойка от превозвача за закъснение', idempotencyKey: `exchange:${contract.id}:penalty`, refType: 'contract', refId: contract.id }]);
  await tx.insert(haulerRatings).values({ contractId: contract.id, ownerUserId: owner.id, haulerUserId }).onConflictDoNothing();
  const [hauler] = await tx.select({ username: users.username }).from(users).where(eq(users.id, haulerUserId));
  await notify(tx, owner.id, 'success', `${hauler?.username ?? 'Превозвачът'} достави стоката ти`, `Оцени превозвача от „Търговия“.`, `/game/trade?rate=${contract.id}`);
}

/** The goods owner rates the hauler (once). */
export async function rateHauler(db: Database, userId: string, contractId: string, stars: number) {
  const n = Math.max(1, Math.min(5, Math.round(stars)));
  const [r] = await db.update(haulerRatings).set({ stars: n }).where(and(eq(haulerRatings.contractId, contractId), eq(haulerRatings.ownerUserId, userId), sql`${haulerRatings.stars} is null`)).returning();
  if (!r) fail('not_found', 'Няма превоз за оценка.', 404);
  return r!;
}

/** A hauler's average stars and how many ratings. */
export async function haulerRating(db: DbOrTx, userId: string) {
  const [r] = await db.select({ avg: sql<number | null>`avg(${haulerRatings.stars})::float`, n: sql<number>`count(${haulerRatings.stars})::int` }).from(haulerRatings).where(eq(haulerRatings.haulerUserId, userId));
  return { stars: r?.avg ?? null, count: r?.n ?? 0 };
}

/** The owner's open offers and the ratings waiting. */
export async function myFreight(db: DbOrTx, companyId: string, userId: string) {
  const offers = await db.select().from(contracts).where(and(eq(contracts.exchange, true), eq(contracts.tradeCompanyId, companyId), inArray(contracts.status, ['open', 'accepted']))).limit(30);
  const toRate = await db.select({ contractId: haulerRatings.contractId, hauler: users.username, goods: contracts.goods }).from(haulerRatings).innerJoin(users, eq(users.id, haulerRatings.haulerUserId)).innerJoin(contracts, eq(contracts.id, haulerRatings.contractId)).where(and(eq(haulerRatings.ownerUserId, userId), sql`${haulerRatings.stars} is null`)).limit(10);
  return { offers, toRate };
}

/** On arrival: sell the lot at today's market price, or put it into the warehouse of the destination depot. */
export async function settleTradeLot(tx: Tx, contract: typeof contracts.$inferSelect, companyId: string, userId: string, at: Date) {
  const lot = contract.trade!;
  const cargo = contract.cargoType as CargoType;
  const [city] = await tx.select({ id: cities.id, countryCode: cities.countryCode, nameBg: cities.nameBg }).from(cities).where(eq(cities.id, contract.destCityId));
  if (lot.mode === 'store') {
    // The destination depot may have been closed meanwhile; then the goods are sold instead.
    const [dest] = lot.destDepotId ? await tx.select().from(depots).where(and(eq(depots.id, lot.destDepotId), eq(depots.companyId, companyId))) : [];
    if (dest) {
      await addStock(tx, dest.id, cargo, lot.tons, lot.costCents);
      await notify(tx, userId, 'success', `Стоката е в склада в ${city!.nameBg}`, `${lot.tons} т ${CARGO[cargo].label.toLowerCase()} са разтоварени в депото ти.`, '/game/trade');
      return;
    }
  }
  const m = await market(tx, contract.destCityId, cargo);
  const price = sellPriceCents(city!, cargo, m?.demand ?? 1, at);
  const revenue = Math.round(price * lot.tons);
  await post(tx, companyId, [{ category: 'trade_sale', amountCents: revenue, description: `Продажба: ${lot.tons} т ${CARGO[cargo].label.toLowerCase()} в ${city!.nameBg}`, idempotencyKey: `trade:sell:${contract.id}`, refType: 'contract', refId: contract.id }]);
  const margin = revenue - lot.costCents;
  await notify(tx, userId, margin >= 0 ? 'success' : 'warning', `Продадена стока в ${city!.nameBg}`, `${lot.tons} т за ${eur(revenue)} (купена за ${eur(lot.costCents)}): ${margin >= 0 ? '+' : ''}${eur(margin)} преди разходите за курса.`, '/game/trade');
}

// ── Views ─────────────────────────────────────────────────────────────────

/** The player's warehouses: capacity, stock and what each depot's city sells and buys today. */
export async function tradeOverview(db: DbOrTx, companyId: string, now = new Date()) {
  const myDepots = await db
    .select({ id: depots.id, slots: depots.slots, cityId: depots.cityId, name: cities.nameBg, countryCode: cities.countryCode })
    .from(depots)
    .innerJoin(cities, eq(cities.id, depots.cityId))
    .where(eq(depots.companyId, companyId));
  if (!myDepots.length) return [];
  const stock = await db.select().from(warehouseStock).where(inArray(warehouseStock.depotId, myDepots.map((d) => d.id)));
  const markets = await db.select().from(cityMarkets).where(inArray(cityMarkets.cityId, myDepots.map((d) => d.cityId)));
  const extra = await plotWarehouseTons(db, companyId);
  return myDepots.map((d) => {
    const city = { id: d.cityId, countryCode: d.countryCode };
    const here = markets.filter((m) => m.cityId === d.cityId);
    return {
      ...d,
      capacityTons: warehouseCapacityTons(d.slots) + (extra?.cityId === d.cityId ? extra.tons : 0),
      usedTons: round1(stock.filter((s) => s.depotId === d.id).reduce((a, s) => a + s.tons, 0)),
      stock: stock.filter((s) => s.depotId === d.id).map((s) => ({ cargo: s.cargoType as CargoType, tons: round1(s.tons), costCents: s.costCents, avgCents: Math.round(s.costCents / Math.max(0.1, s.tons)) })),
      buy: CARGO_TYPES.filter((c) => here.some((m) => m.cargoType === c && m.produces)).map((c) => ({ cargo: c, priceCents: buyPriceCents(city, c, now) })),
      sell: CARGO_TYPES.filter((c) => here.some((m) => m.cargoType === c && m.consumes)).map((c) => ({ cargo: c, priceCents: sellPriceCents(city, c, here.find((m) => m.cargoType === c)!.demand, now) })),
    };
  });
}

/** Where a cargo sells best today, seen from a depot city (with straight-line distance). */
export async function bestBuyers(db: DbOrTx, fromCityId: number, cargo: CargoType, now = new Date(), limit = 12) {
  const [from] = await db.select().from(cities).where(eq(cities.id, fromCityId));
  const rows = await db
    .select({ id: cities.id, nameBg: cities.nameBg, countryCode: cities.countryCode, lat: cities.lat, lon: cities.lon, demand: cityMarkets.demand })
    .from(cityMarkets)
    .innerJoin(cities, eq(cities.id, cityMarkets.cityId))
    .where(and(eq(cityMarkets.cargoType, cargo), eq(cityMarkets.consumes, true)));
  return rows
    .filter((r) => r.id !== fromCityId)
    .map((r) => ({ id: r.id, name: r.nameBg, countryCode: r.countryCode, priceCents: sellPriceCents(r, cargo, r.demand, now), km: Math.round(haversineKm([from!.lat, from!.lon], [r.lat, r.lon]) * 1.25) }))
    .sort((a, b) => b.priceCents - a.priceCents)
    .slice(0, limit);
}
