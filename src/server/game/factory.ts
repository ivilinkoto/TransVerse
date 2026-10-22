import { and, eq, gt, isNotNull, lte, or, sql } from 'drizzle-orm';
import { rewardCents } from '@/lib/game/economy';
import { batchHours, batchTons, canMake, FACTORY, loadsOf, RAW, recipeOf, type RawId, type RawStock } from '@/lib/game/factory';
import { contractWindowMinutes } from '@/lib/game/schedule';
import { islandOf } from '@/lib/game/crossings';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companyBuildings, companyFactories, contracts, deliveries, organizations } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { loadHubs } from './contracts';
import { fail } from './errors';
import { postTreasury } from './finance';
import { notifyMembers, requirePermission } from './membership';
import { shipperName } from './names';
import { broadcast } from './notify';

/**
 * The company factory (v1.4, see lib/game/factory.ts). Raw materials and the
 * product travel as members-only loads (like building materials); money for
 * raw materials leaves the treasury, the sale of the product comes into it.
 */

async function factoryLevel(db: DbOrTx, organizationId: string) {
  const [b] = await db.select({ level: companyBuildings.level }).from(companyBuildings).where(and(eq(companyBuildings.organizationId, organizationId), eq(companyBuildings.type, 'factory')));
  return b?.level ?? 0;
}

async function factoryRow(db: DbOrTx, organizationId: string, lock = false) {
  await db.insert(companyFactories).values({ organizationId }).onConflictDoNothing();
  const q = db.select().from(companyFactories).where(eq(companyFactories.organizationId, organizationId));
  return (lock ? await q.for('update') : await q)[0]!;
}

async function requireFactory(tx: Tx, actorId: string) {
  if (!(await featureFor(tx, actorId, 'factories'))) fail('not_released', 'Това идва със следващото обновление.', 403);
  const actor = await requirePermission(tx, actorId, 'build');
  const level = await factoryLevel(tx, actor.company.id);
  if (level < 1) fail('no_factory', 'Първо постройте фабрика на участъка.');
  return { actor, level, factory: await factoryRow(tx, actor.company.id, true) };
}

/** Tonnes of each raw material on the way (open loads and loads being driven). */
async function rawOnTheWay(db: DbOrTx, organizationId: string, now: Date): Promise<RawStock> {
  const rows = await db
    .select({ material: contracts.material, tons: sql<number>`sum(${contracts.weightTons})::float` })
    .from(contracts)
    .leftJoin(deliveries, eq(deliveries.contractId, contracts.id))
    .where(and(eq(contracts.factoryOrgId, organizationId), sql`${contracts.material} <> 'product'`, or(and(eq(contracts.status, 'open'), gt(contracts.expiresAt, now)), eq(deliveries.status, 'in_progress'))))
    .groupBy(contracts.material);
  return Object.fromEntries(rows.filter((r) => r.material).map((r) => [r.material, r.tons])) as RawStock;
}

/** Everything the factory page needs. */
export async function factoryView(db: DbOrTx, organizationId: string, now = new Date()) {
  const level = await factoryLevel(db, organizationId);
  const f = level ? await factoryRow(db, organizationId) : null;
  return { level, factory: f, recipe: recipeOf(f?.recipe), onTheWay: level ? await rawOnTheWay(db, organizationId, now) : {}, buyers: f?.recipe ? await buyers(db, organizationId) : [] };
}

export async function chooseRecipe(db: Database, actorId: string, recipeId: string) {
  const recipe = recipeOf(recipeId);
  if (!recipe) fail('unknown_recipe', 'Непознато производство.');
  return db.transaction(async (tx) => {
    const { actor, factory } = await requireFactory(tx, actorId);
    if (factory.recipe === recipeId) return factory;
    const stocked = Object.values(factory.stock).some((t) => (t ?? 0) > 0);
    if (factory.batchEndsAt || stocked || factory.productTons > 0) fail('busy', 'Сменя се само когато фабриката е празна (без суровини, партида и продукция).');
    const [row] = await tx.update(companyFactories).set({ recipe: recipeId, updatedAt: new Date() }).where(eq(companyFactories.organizationId, actor.company.id)).returning();
    return row!;
  });
}

/** The nearest real city (≥ 30 km) that produces a raw material's cargo. */
async function supplier(db: DbOrTx, hqCityId: number, raw: RawId) {
  const hubs = await loadHubs(db);
  const hq = hubs.find((h) => h.id === hqCityId) ?? (await db.select().from(cities).where(eq(cities.id, hqCityId)))[0];
  if (!hq) return null;
  const far = (h: { lat: number; lon: number }) => haversineKm([hq.lat, hq.lon], [h.lat, h.lon]);
  const candidates = hubs.filter((h) => h.id !== hqCityId && far(h) >= 30 && islandOf(h)?.id === islandOf(hq)?.id).sort((a, b) => far(a) - far(b));
  return candidates.find((h) => h.produces.has(RAW[raw].cargo)) ?? candidates[0] ?? null;
}

/** Orders the raw materials for some batches: the treasury pays, the loads go to the members' board. */
export async function orderRaw(db: Database, actorId: string, batches: number, now = new Date(), provider?: RoutingProvider) {
  const n = Math.max(1, Math.min(FACTORY.maxBatches, Math.round(batches)));
  const pre = await db.transaction(async (tx) => {
    const { actor, factory } = await requireFactory(tx, actorId);
    const recipe = recipeOf(factory.recipe);
    if (!recipe) fail('no_recipe', 'Изберете какво произвежда фабриката.');
    return { org: actor.company, recipe: recipe! };
  });
  const plans: { raw: RawId; from: number; routeId: number; km: number }[] = [];
  for (const raw of Object.keys(pre.recipe.inputs) as RawId[]) {
    const s = await supplier(db, pre.org.hqCityId, raw);
    if (!s) continue;
    const route = await getRoute(db, s.id, pre.org.hqCityId, 'truck', provider);
    plans.push({ raw, from: s.id, routeId: route.id, km: route.distanceKm });
  }
  return db.transaction(async (tx) => {
    const { actor, factory } = await requireFactory(tx, actorId);
    const recipe = recipeOf(factory.recipe)!;
    const coming = await rawOnTheWay(tx, actor.company.id, now);
    const need: RawStock = {};
    for (const [raw, t] of Object.entries(recipe.inputs) as [RawId, number][]) {
      const left = t * n - (factory.stock[raw] ?? 0) - (coming[raw] ?? 0);
      if (left > 0.05) need[raw] = Math.round(left * 10) / 10;
    }
    if (!Object.keys(need).length) fail('enough', 'Суровините за тези партиди вече са на участъка или на път.');
    const cost = Object.entries(need).reduce((s, [raw, t]) => s + RAW[raw as RawId].priceCents * (t ?? 0), 0);
    await postTreasury(tx, actor.company.id, [{ category: 'factory', amountCents: -Math.round(cost), description: `Суровини: ${recipe.label} (${n} ${n === 1 ? 'партида' : 'партиди'})`, idempotencyKey: `factory:${actor.company.id}:raw:${now.getTime()}`, actorUserId: actorId, refType: 'factory', refId: actor.company.id }], { requireFunds: true });
    let loads = 0;
    for (const [raw, tons] of Object.entries(need) as [RawId, number][]) {
      const plan = plans.find((p) => p.raw === raw);
      if (!plan) continue;
      const def = RAW[raw];
      for (const t of loadsOf(tons, def.cargo === 'bulk' ? FACTORY.bulkLoadTons : FACTORY.loadTons)) {
        await tx.insert(contracts).values({
          shipper: shipperName(), goods: def.goods, cargoType: def.cargo, weightTons: t,
          originCityId: plan.from, destCityId: actor.company.hqCityId, routeId: plan.routeId, distanceKm: plan.km,
          rewardCents: rewardCents(def.cargo, t, plan.km, 1), windowMinutes: contractWindowMinutes(plan.km), minLevel: 1,
          factoryOrgId: actor.company.id, material: raw, createdBy: actorId, createdAt: now, expiresAt: new Date(now.getTime() + FACTORY.loadHours * 3_600_000),
        });
        loads++;
      }
    }
    await notifyMembers(tx, actor.company.id, null, 'Суровини за фабриката', `${loads} ${loads === 1 ? 'товар чака' : 'товара чакат'} на борсата — само за членовете.`, '/game/contracts');
    await broadcast(tx, 'market');
    return { loads, costCents: Math.round(cost) };
  });
}

/** Real cities that buy the product: they consume its cargo, up to 700 km away; the best price first. */
export async function buyers(db: DbOrTx, organizationId: string) {
  const [org] = await db.select({ hq: organizations.hqCityId }).from(organizations).where(eq(organizations.id, organizationId));
  const f = await factoryRow(db, organizationId);
  const recipe = recipeOf(f.recipe);
  if (!org || !recipe) return [];
  const hubs = await loadHubs(db);
  const hq = hubs.find((h) => h.id === org.hq);
  if (!hq) return [];
  return hubs
    .filter((h) => h.id !== hq.id && h.consumes.has(recipe.output.cargo) && islandOf(h)?.id === islandOf(hq)?.id)
    .map((h) => {
      const km = haversineKm([hq.lat, hq.lon], [h.lat, h.lon]) * 1.25;
      // Demand moves the price ±30 %.
      const factor = Math.min(1.3, Math.max(0.8, h.consumes.get(recipe.output.cargo) ?? 1));
      return { cityId: h.id, km, priceCentsPerTon: Math.round(recipe.output.priceCentsPerTon * factor) };
    })
    .filter((b) => b.km >= 40 && b.km <= FACTORY.buyerMaxKm)
    .sort((a, b) => b.priceCentsPerTon - a.priceCentsPerTon || a.km - b.km)
    .slice(0, 5);
}

/** Sends the product to a buyer: members-only loads; each one pays the treasury on arrival. */
export async function sellProduct(db: Database, actorId: string, buyerCityId: number, now = new Date(), provider?: RoutingProvider) {
  const pre = await db.transaction(async (tx) => {
    const { actor } = await requireFactory(tx, actorId);
    const b = (await buyers(tx, actor.company.id)).find((x) => x.cityId === buyerCityId);
    if (!b) fail('no_buyer', 'Този град не купува продукцията.');
    return { org: actor.company, buyer: b! };
  });
  const route = await getRoute(db, pre.org.hqCityId, buyerCityId, 'truck', provider);
  return db.transaction(async (tx) => {
    const { actor, factory } = await requireFactory(tx, actorId);
    const recipe = recipeOf(factory.recipe)!;
    const tons = Math.floor(factory.productTons * 10) / 10;
    if (tons < 0.5) fail('no_product', 'Няма готова продукция.');
    const max = recipe.output.cargo === 'bulk' ? FACTORY.bulkLoadTons : recipe.output.cargo === 'steel' ? 20 : FACTORY.loadTons;
    const parts = loadsOf(tons, max);
    for (const t of parts) {
      await tx.insert(contracts).values({
        shipper: actor.company.name.slice(0, 60), goods: recipe.output.goods, cargoType: recipe.output.cargo, weightTons: t,
        originCityId: actor.company.hqCityId, destCityId: buyerCityId, routeId: route.id, distanceKm: route.distanceKm,
        rewardCents: rewardCents(recipe.output.cargo, t, route.distanceKm, 1), windowMinutes: contractWindowMinutes(route.distanceKm), minLevel: 1,
        factoryOrgId: actor.company.id, material: 'product', factorySaleCents: Math.round(t * pre.buyer.priceCentsPerTon),
        createdBy: actorId, createdAt: now, expiresAt: new Date(now.getTime() + FACTORY.loadHours * 3_600_000),
      });
    }
    await tx.update(companyFactories).set({ productTons: sql`greatest(0, ${companyFactories.productTons} - ${tons})`, updatedAt: now }).where(eq(companyFactories.organizationId, actor.company.id));
    await notifyMembers(tx, actor.company.id, null, `Продукция за продан: ${recipe.label}`, `${parts.length} ${parts.length === 1 ? 'товар' : 'товара'} (${tons} т) чакат на борсата — парите от продажбата влизат в касата.`, '/game/contracts');
    await broadcast(tx, 'market');
    return { loads: parts.length, tons, valueCents: Math.round(tons * pre.buyer.priceCentsPerTon) };
  });
}

/** At settlement: raw materials go into the factory's stock; a product load pays the treasury. */
export async function recordFactoryDelivery(tx: Tx, contract: { id: string; factoryOrgId: string | null; material: string | null; weightTons: number; factorySaleCents: number | null; goods: string }) {
  if (!contract.factoryOrgId || !contract.material) return;
  const f = await factoryRow(tx, contract.factoryOrgId, true);
  if (contract.material === 'product') {
    const value = contract.factorySaleCents ?? 0;
    if (value > 0) await postTreasury(tx, contract.factoryOrgId, [{ category: 'factory', amountCents: value, description: `Продадена продукция: ${contract.goods} (${contract.weightTons} т)`, idempotencyKey: `factory-sale:${contract.id}`, refType: 'contract', refId: contract.id }]);
    await tx.update(companyFactories).set({ soldCents: sql`${companyFactories.soldCents} + ${value}`, updatedAt: new Date() }).where(eq(companyFactories.organizationId, f.organizationId));
    return;
  }
  const stock = { ...f.stock, [contract.material]: Math.round(((f.stock[contract.material] ?? 0) + contract.weightTons) * 10) / 10 };
  await tx.update(companyFactories).set({ stock, updatedAt: new Date() }).where(eq(companyFactories.organizationId, f.organizationId));
}

/**
 * Worker: finished batches become product, a new batch starts when the raw
 * materials are there; product loads that ran out on the board come back.
 */
export async function runFactories(db: Database, now = new Date()) {
  const rows = await db.select().from(companyFactories).where(isNotNull(companyFactories.recipe));
  let n = 0;
  for (const row of rows) {
    await db.transaction(async (tx) => {
      const [f] = await tx.select().from(companyFactories).where(eq(companyFactories.organizationId, row.organizationId)).for('update');
      const recipe = recipeOf(f?.recipe);
      if (!f || !recipe) return;
      const level = await factoryLevel(tx, f.organizationId);
      let { productTons, stock, batchEndsAt, batches } = f;
      if (batchEndsAt && batchEndsAt <= now) {
        productTons = Math.round((productTons + (f.batchTons ?? batchTons(recipe, level))) * 10) / 10;
        batches++;
        batchEndsAt = null;
        await notifyMembers(tx, f.organizationId, 'build', `Партида готова: ${recipe.label}`, `Във фабриката има ${productTons} т продукция — пуснете я за продан.`, '/game/company/factory');
        n++;
      }
      if (!batchEndsAt && level > 0 && canMake(recipe, stock)) {
        stock = Object.fromEntries(Object.entries(stock).map(([id, t]) => [id, Math.round(((t ?? 0) - (recipe.inputs[id as RawId] ?? 0)) * 10) / 10]));
        batchEndsAt = new Date(now.getTime() + batchHours(recipe, level) * 3_600_000);
        await tx.update(companyFactories).set({ batchTons: batchTons(recipe, level) }).where(eq(companyFactories.organizationId, f.organizationId));
      }
      // Product loads nobody took come back to the factory.
      const back = await tx.update(contracts).set({ status: 'returned' }).where(and(eq(contracts.factoryOrgId, f.organizationId), eq(contracts.material, 'product'), or(eq(contracts.status, 'expired'), and(eq(contracts.status, 'open'), lte(contracts.expiresAt, now))))).returning({ tons: contracts.weightTons });
      productTons = Math.round((productTons + back.reduce((s, b) => s + b.tons, 0)) * 10) / 10;
      await tx.update(companyFactories).set({ productTons, stock, batchEndsAt, batches, updatedAt: now }).where(eq(companyFactories.organizationId, f.organizationId));
    });
  }
  return n;
}
