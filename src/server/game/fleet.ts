import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { featureFor } from '@/server/features';
import { POWER_UNITS, TRAILERS, UPGRADES, couplingError, powerUnitModel, trailerModel, type UpgradeId } from '@/lib/game/catalog';
import { ECONOMY, repairCostCents, resaleValueCents } from '@/lib/game/economy';
import type { Database, DbOrTx } from '@/server/db/client';
import { cityMarkets, companies, depots, drivers, trailers, users, vehicleLeases, vehicles } from '@/server/db/schema';
import { money } from '@/lib/format';
import { LEASE, leaseTerms } from '@/lib/game/leasing';
import { maintenanceCostCents, maintenanceState } from '@/lib/game/maintenance';
import { assertNotLeased } from './leasing';
import { bonusesForUser } from './membership';
import { isVip, VIP_PERKS } from '@/lib/game/vip';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { uniquePlate, VEHICLE_COLORS } from './names';
import { retireRentalFor } from './rentals';
import { logActivity, notify } from './notify';
import { checkAchievements } from './progression';
import { pick } from './random';

async function level(db: DbOrTx, userId: string) {
  const [u] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  return u?.level ?? 1;
}

/** Whether the owner of a player account is VIP right now. */
export async function ownerIsVip(db: DbOrTx, companyId: string, now = new Date()): Promise<boolean> {
  const [row] = await db.select({ vipUntil: users.vipUntil }).from(companies).innerJoin(users, eq(users.id, companies.ownerId)).where(eq(companies.id, companyId));
  return isVip(row?.vipUntil, now);
}

async function fleetCapacity(db: DbOrTx, companyId: string) {
  const [{ slots = 0, depots: n = 0 } = {}] = await db
    .select({ slots: sql<number>`coalesce(sum(${depots.slots}), 0)::int`, depots: sql<number>`count(*)::int` })
    .from(depots)
    .where(eq(depots.companyId, companyId));
  // A borrowed company truck stands on the company's parking, not in the member's depot.
  const [{ used = 0 } = {}] = await db.select({ used: sql<number>`count(*)::int` }).from(vehicles).where(and(eq(vehicles.companyId, companyId), isNull(vehicles.soldAt), ne(vehicles.ownership, 'company')));
  // VIP: one extra place in every depot.
  let extra = (await ownerIsVip(db, companyId)) ? n * VIP_PERKS.extraSlotsPerDepot : 0;
  // The parking on the company's plot: places in the member's depot in the company's base city.
  const [owner] = await db.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, companyId));
  const perks = owner ? await bonusesForUser(db, owner.ownerId) : null;
  if (perks?.bonuses.parkingSlots) {
    const [home] = await db.select({ id: depots.id }).from(depots).where(and(eq(depots.companyId, companyId), eq(depots.cityId, perks.membership.company.hqCityId)));
    if (home) extra += perks.bonuses.parkingSlots;
  }
  return { slots: slots + extra, used, extra };
}

async function depotInCity(db: DbOrTx, companyId: string, cityId: number) {
  const [depot] = await db.select().from(depots).where(and(eq(depots.companyId, companyId), eq(depots.cityId, cityId)));
  if (!depot) fail('no_depot', 'Нямате депо в този град.');
  return depot!;
}

/** Buys a truck outright, or on lease (`lease`: a down payment now, weekly instalments after). */
export async function buyVehicle(db: Database, userId: string, modelId: string, depotCityId: number, options: { lease?: boolean; now?: Date } = {}) {
  const model = POWER_UNITS.find((m) => m.id === modelId);
  if (!model) fail('unknown_model', 'Непознат модел.');
  const now = options.now ?? new Date();
  if (model!.electric && !(await featureFor(db, userId, 'electric', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  if (options.lease && model!.priceCents < LEASE.minPriceCents) fail('lease_unavailable', 'Лизинг има за камиони от ' + money(LEASE.minPriceCents) + ' нагоре.');
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    if ((await level(tx, userId)) < model!.minLevel) fail('level', `Изисква ниво ${model!.minLevel}.`);
    await depotInCity(tx, company.id, depotCityId);
    const cap = await fleetCapacity(tx, company.id);
    if (cap.used >= cap.slots) fail('no_capacity', 'Нямате свободни места в депата. Разширете депо или открийте ново.');
    if (options.lease) {
      const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(vehicleLeases).where(and(eq(vehicleLeases.companyId, company.id), eq(vehicleLeases.status, 'active')));
      if (n >= LEASE.maxActive) fail('lease_limit', `Може да имаш най-много ${LEASE.maxActive} лизинга едновременно.`);
    }
    const [vehicle] = await tx.insert(vehicles).values({ companyId: company.id, modelId: model!.id, plate: await uniquePlate(tx), color: pick(VEHICLE_COLORS), cityId: depotCityId, purchasePriceCents: model!.priceCents }).returning();
    if (options.lease) {
      const terms = leaseTerms(model!.priceCents);
      await post(tx, company.id, [{ category: 'lease', amountCents: -terms.downCents, description: `Лизинг: първоначална вноска за ${model!.name} (${vehicle!.plate})`, idempotencyKey: `lease:vehicle:${vehicle!.id}:down`, refType: 'vehicle', refId: vehicle!.id }], { requireFunds: true });
      await tx.insert(vehicleLeases).values({ vehicleId: vehicle!.id, companyId: company.id, priceCents: model!.priceCents, downCents: terms.downCents, weeklyCents: terms.weeklyCents, payments: terms.payments, nextDueAt: new Date(now.getTime() + LEASE.periodDays * 86_400_000), createdAt: now });
    } else {
      await post(tx, company.id, [{ category: 'vehicle_purchase', amountCents: -model!.priceCents, description: `${model!.name} (${vehicle!.plate})`, idempotencyKey: `buy:vehicle:${vehicle!.id}`, refType: 'vehicle', refId: vehicle!.id }], { requireFunds: true });
    }
    // A truck of their own replaces the rented one (now, or when its current trip ends).
    const rental = await retireRentalFor(tx, company.id, vehicle!.id);
    await logActivity(tx, userId, 'vehicle_bought', { vehicleId: vehicle!.id, modelId, rental });
    await checkAchievements(tx, userId, company.id);
    return vehicle!;
  });
}

export async function buyTrailer(db: Database, userId: string, modelId: string, depotCityId: number) {
  const model = TRAILERS.find((m) => m.id === modelId);
  if (!model) fail('unknown_model', 'Непознат модел.');
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    if ((await level(tx, userId)) < model!.minLevel) fail('level', `Изисква ниво ${model!.minLevel}.`);
    await depotInCity(tx, company.id, depotCityId);
    const [trailer] = await tx.insert(trailers).values({ companyId: company.id, modelId: model!.id, plate: await uniquePlate(tx), cityId: depotCityId, purchasePriceCents: model!.priceCents }).returning();
    await post(tx, company.id, [{ category: 'vehicle_purchase', amountCents: -model!.priceCents, description: `${model!.name} (${trailer!.plate})`, idempotencyKey: `buy:trailer:${trailer!.id}`, refType: 'trailer', refId: trailer!.id }], { requireFunds: true });
    await logActivity(tx, userId, 'trailer_bought', { trailerId: trailer!.id, modelId });
    return trailer!;
  });
}

async function ownedVehicle(db: DbOrTx, companyId: string, vehicleId: string) {
  const [v] = await db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, companyId), isNull(vehicles.soldAt))).for('update');
  if (!v) fail('vehicle_not_found', 'Превозното средство не е намерено.', 404);
  return v!;
}

async function ownedTrailer(db: DbOrTx, companyId: string, trailerId: string) {
  const [t] = await db.select().from(trailers).where(and(eq(trailers.id, trailerId), eq(trailers.companyId, companyId), isNull(trailers.soldAt))).for('update');
  if (!t) fail('trailer_not_found', 'Ремаркето не е намерено.', 404);
  return t!;
}

const ageDays = (d: Date) => (Date.now() - d.getTime()) / 86_400_000;

export async function sellVehicle(db: Database, userId: string, vehicleId: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const v = await ownedVehicle(tx, company.id, vehicleId);
    if (v.ownership === 'rented') fail('rented', 'Наетите превозни средства се връщат, не се продават.');
    if (v.ownership === 'company') fail('company_truck', 'Фирменият камион е на компанията — върнете го, не се продава.');
    if (v.status === 'listed') fail('listed', 'Превозното средство е обявено на пазара — първо свали обявата.');
    if (v.status !== 'idle') fail('vehicle_busy', 'Не можете да продадете превозно средство по време на курс.');
    await assertNotLeased(tx, v.id);
    const model = powerUnitModel(v.modelId);
    const value = resaleValueCents(model.priceCents, v.condition, ageDays(v.purchasedAt));
    await tx.update(trailers).set({ vehicleId: null }).where(eq(trailers.vehicleId, v.id));
    await tx.update(drivers).set({ vehicleId: null }).where(eq(drivers.vehicleId, v.id));
    await tx.update(drivers).set({ coVehicleId: null }).where(eq(drivers.coVehicleId, v.id));
    await post(tx, company.id, [{ category: 'vehicle_sale', amountCents: value, description: `Продажба: ${model.name} (${v.plate})`, idempotencyKey: `sell:vehicle:${v.id}`, refType: 'vehicle', refId: v.id }]);
    await tx.update(vehicles).set({ status: 'sold', soldAt: new Date() }).where(eq(vehicles.id, v.id));
    await logActivity(tx, userId, 'vehicle_sold', { vehicleId: v.id, value });
    return value;
  });
}

export async function sellTrailer(db: Database, userId: string, trailerId: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const t = await ownedTrailer(tx, company.id, trailerId);
    if (t.ownership === 'rented') fail('rented', 'Наетите ремаркета се връщат заедно с влекача.');
    if (t.listed) fail('listed', 'Ремаркето е обявено на пазара — първо свали обявата.');
    if (t.vehicleId) {
      const [v] = await tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, t.vehicleId));
      if (v?.status === 'on_delivery') fail('trailer_busy', 'Ремаркето е на курс.');
    }
    const model = trailerModel(t.modelId);
    const value = resaleValueCents(model.priceCents, t.condition, ageDays(t.purchasedAt));
    await post(tx, company.id, [{ category: 'vehicle_sale', amountCents: value, description: `Продажба: ${model.name} (${t.plate})`, idempotencyKey: `sell:trailer:${t.id}`, refType: 'trailer', refId: t.id }]);
    await tx.update(trailers).set({ vehicleId: null, soldAt: new Date() }).where(eq(trailers.id, t.id));
    return value;
  });
}

export async function repairVehicle(db: Database, userId: string, vehicleId: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const v = await ownedVehicle(tx, company.id, vehicleId);
    if (v.ownership === 'rented') fail('rented', 'Поддръжката на наетите превозни средства е за сметка на наемодателя.');
    if (v.status !== 'idle') fail('vehicle_busy', 'Ремонт е възможен само между курсовете.');
    const [trailer] = await tx.select().from(trailers).where(eq(trailers.vehicleId, v.id));
    const full = repairCostCents(powerUnitModel(v.modelId).priceCents, v.condition) + (trailer ? repairCostCents(trailerModel(trailer.modelId).priceCents, trailer.condition) : 0);
    if (full <= 0) fail('nothing_to_repair', 'Няма нужда от ремонт.');
    // VIP and the company's service on the plot make it cheaper.
    const service = (await bonusesForUser(tx, userId))?.bonuses.repairDiscount ?? 0;
    const cost = Math.round(full * (1 - ((await ownerIsVip(tx, company.id)) ? VIP_PERKS.garageDiscount : 0)) * (1 - service));
    await post(tx, company.id, [{ category: 'repairs', amountCents: -cost, description: `Ремонт ${v.plate}`, idempotencyKey: `repair:${v.id}:${v.odometerKm.toFixed(1)}:${v.condition.toFixed(3)}` }], { requireFunds: true });
    await tx.update(vehicles).set({ condition: 100 }).where(eq(vehicles.id, v.id));
    if (trailer) await tx.update(trailers).set({ condition: 100 }).where(eq(trailers.id, trailer.id));
    return cost;
  });
}

/** Maintenance: services an idle own truck (its kilometres since the last service start again). */
export async function serviceVehicle(db: Database, userId: string, vehicleId: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const v = await ownedVehicle(tx, company.id, vehicleId);
    if (v.ownership === 'rented') fail('rented', 'Поддръжката на наетите превозни средства е за сметка на наемодателя.');
    if (v.status !== 'idle') fail('vehicle_busy', 'Профилактика се прави само между курсовете.');
    if (maintenanceState(v.odometerKm, v.serviceKm).fresh) fail('fresh', 'Камионът наскоро мина профилактика.');
    const service = (await bonusesForUser(tx, userId))?.bonuses.repairDiscount ?? 0;
    const vip = (await ownerIsVip(tx, company.id)) ? VIP_PERKS.garageDiscount : 0;
    const cost = maintenanceCostCents(powerUnitModel(v.modelId).priceCents, 1 - (1 - service) * (1 - vip));
    await post(tx, company.id, [{ category: 'maintenance', amountCents: -cost, description: `Профилактика ${v.plate}`, idempotencyKey: `service:${v.id}:${v.odometerKm.toFixed(1)}`, refType: 'vehicle', refId: v.id }], { requireFunds: true });
    await tx.update(vehicles).set({ serviceKm: v.odometerKm }).where(eq(vehicles.id, v.id));
    return cost;
  });
}

export async function installUpgrade(db: Database, userId: string, vehicleId: string, upgradeId: string) {
  const upgrade = UPGRADES[upgradeId as UpgradeId];
  if (!upgrade) fail('unknown_upgrade', 'Непознато подобрение.');
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const v = await ownedVehicle(tx, company.id, vehicleId);
    if (v.ownership !== 'owned') fail('rented', 'Наетите и фирмените превозни средства не могат да се модифицират.');
    if (v.status !== 'idle') fail('vehicle_busy', 'Подобрения се монтират само между курсовете.');
    if (!upgrade!.appliesTo.includes(powerUnitModel(v.modelId).kind)) fail('not_applicable', 'Подобрението не е приложимо за този тип превозно средство.');
    if (v.upgrades.includes(upgrade!.id)) fail('already_installed', 'Вече е монтирано.');
    const price = Math.round(upgrade!.priceCents * (1 - ((await ownerIsVip(tx, company.id)) ? VIP_PERKS.garageDiscount : 0)));
    await post(tx, company.id, [{ category: 'upgrades', amountCents: -price, description: `${upgrade!.label} — ${v.plate}`, idempotencyKey: `upgrade:${v.id}:${upgrade!.id}` }], { requireFunds: true });
    await tx.update(vehicles).set({ upgrades: [...v.upgrades, upgrade!.id] }).where(eq(vehicles.id, v.id));
  });
}

/** Couples a semi-trailer to a tractor or a drawbar trailer to a rigid truck in the same city (or uncouples when trailerId is null). */
export async function coupleTrailer(db: Database, userId: string, vehicleId: string, trailerId: string | null) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const v = await ownedVehicle(tx, company.id, vehicleId);
    if (v.status !== 'idle') fail('vehicle_busy', 'Камионът е на курс.');
    const unit = powerUnitModel(v.modelId);
    if (unit.kind === 'van') fail('not_tractor', 'Ванът не тегли ремарке.');
    await tx.update(trailers).set({ vehicleId: null }).where(eq(trailers.vehicleId, v.id));
    if (!trailerId) return;
    const t = await ownedTrailer(tx, company.id, trailerId);
    if (t.listed) fail('listed', 'Ремаркето е обявено на пазара.');
    if (t.cityId !== v.cityId) fail('different_city', 'Ремаркето и камионът трябва да са в един град.');
    if (t.vehicleId) {
      const [other] = await tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, t.vehicleId));
      if (other?.status !== 'idle') fail('trailer_busy', 'Ремаркето е на курс.');
    }
    const why = couplingError(unit, trailerModel(t.modelId));
    if (why) fail('incompatible_trailer', why);
    await tx.update(trailers).set({ vehicleId: v.id }).where(eq(trailers.id, t.id));
  });
}

export async function buyDepot(db: Database, userId: string, cityId: number) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [hub] = await tx.select().from(cityMarkets).where(eq(cityMarkets.cityId, cityId)).limit(1);
    if (!hub) fail('not_hub', 'Депо може да се открие само в град, участващ в товарния пазар.');
    const [existing] = await tx.select().from(depots).where(and(eq(depots.companyId, company.id), eq(depots.cityId, cityId)));
    if (existing) fail('depot_exists', 'Вече имате депо в този град.');
    const [depot] = await tx.insert(depots).values({ companyId: company.id, cityId, slots: ECONOMY.depotSlotsDefault }).returning();
    await post(tx, company.id, [{ category: 'depots', amountCents: -ECONOMY.depotPriceCents, description: 'Ново депо', idempotencyKey: `depot:${depot!.id}` }], { requireFunds: true });
    await notify(tx, userId, 'success', 'Ново депо', 'Можете да купувате и паркирате техника там.', '/game/logistics');
    await checkAchievements(tx, userId, company.id);
    return depot!;
  });
}

export async function expandDepot(db: Database, userId: string, depotId: string) {
  return db.transaction(async (tx) => {
    const company = await companyForUser(tx, userId);
    const [depot] = await tx.select().from(depots).where(and(eq(depots.id, depotId), eq(depots.companyId, company.id))).for('update');
    if (!depot) fail('depot_not_found', 'Депото не е намерено.', 404);
    if (depot!.slots >= 20) fail('max_slots', 'Депото е с максимален капацитет.');
    const cost = ECONOMY.depotSlotUpgradeCents * Math.ceil(depot!.slots / 3);
    await post(tx, company.id, [{ category: 'depots', amountCents: -cost, description: `Разширение на депо (${depot!.slots + 1} места)`, idempotencyKey: `depot:${depot!.id}:slot:${depot!.slots + 1}` }], { requireFunds: true });
    await tx.update(depots).set({ slots: depot!.slots + 1 }).where(eq(depots.id, depot!.id));
    return cost;
  });
}

export function depotSlotCostCents(slots: number) {
  return ECONOMY.depotSlotUpgradeCents * Math.ceil(slots / 3);
}

export { fleetCapacity };
