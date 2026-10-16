import { and, asc, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { CARGO, canCarry, type CargoType } from '@/lib/game/cargo';
import { combinationCapability, powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { ECONOMY, rentalFeeCents, settle, tripCosts, upgradeFactor } from '@/lib/game/economy';
import { deliveryXp, reputationAfter, seasonPoints } from '@/lib/game/progression';
import { buildGameSchedule, compressSchedule, contractWindowMinutes, gameDurationMinutes, scheduleEnd, SCHEDULE_VERSION, type Segment } from '@/lib/game/schedule';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, cityMarkets, companies, companyMembers, contracts, deliveries, drivers, trailers, users, vehicles } from '@/server/db/schema';
import { getRoute } from '@/server/geo/route-service';
import { companyForUser } from './company';
import { fail } from './errors';
import { post, type Posting } from './finance';
import { broadcast, logActivity, notify } from './notify';
import { awardXp, checkAchievements } from './progression';
import { addCompanyXp, bonusesForUser } from './membership';
import { addSeasonScore } from './seasons';

const timeScale = () => Math.max(1, Number(process.env.GAME_TIME_SCALE ?? 1));

/** Validates that a vehicle (with its trailer and driver) can legally take a contract. */
export function compatibilityError(
  input: { modelId: string; trailerModelId: string | null; condition: number; hasDriver: boolean; status: string },
  contract: { cargoType: string; weightTons: number; minLevel: number },
  level: number,
): string | null {
  const unit = powerUnitModel(input.modelId);
  const trailer = input.trailerModelId ? trailerModel(input.trailerModelId) : null;
  const cargo = contract.cargoType as CargoType;
  if (input.status !== 'idle') return 'Превозното средство е заето.';
  if (!input.hasDriver) return 'Няма назначен шофьор.';
  if (unit.kind === 'tractor' && !trailer) return 'Влекачът няма прикачено ремарке.';
  const cap = combinationCapability({ unit, trailer });
  if (!canCarry(cap.bodies, cargo)) return `Нужна е надстройка: ${CARGO[cargo].bodies.map((b) => BODY_LABELS[b]).join(' или ')}.`;
  if (contract.weightTons > cap.payloadTons) return `Товарът (${contract.weightTons} т) надвишава капацитета (${cap.payloadTons} т).`;
  if (input.condition < ECONOMY.minConditionForJobs) return 'Техниката е в лошо състояние — нужен е ремонт.';
  if (level < Math.max(contract.minLevel, CARGO[cargo].minLevel)) return `Изисква ниво ${Math.max(contract.minLevel, CARGO[cargo].minLevel)}.`;
  return null;
}

export const BODY_LABELS: Record<string, string> = {
  box: 'фургон',
  curtain: 'завеса',
  reefer: 'хладилна',
  tipper: 'самосвал',
  tanker: 'цистерна',
  container: 'контейнерно шаси',
  lowbed: 'нискорамно ремарке',
};

async function vehicleBundle(db: DbOrTx, companyId: string, vehicleId: string, lock = false) {
  const q = db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, companyId)));
  const [vehicle] = lock ? await q.for('update') : await q;
  if (!vehicle) fail('vehicle_not_found', 'Превозното средство не е намерено.', 404);
  const [trailer] = await db.select().from(trailers).where(eq(trailers.vehicleId, vehicleId));
  const [driver] = await db.select().from(drivers).where(eq(drivers.vehicleId, vehicleId));
  return { vehicle: vehicle!, trailer: trailer ?? null, driver: driver ?? null };
}

/**
 * Player accepts a market contract with one of their vehicles. Routes are
 * resolved first (network), then everything is committed atomically. Only one
 * company can ever win a contract (conditional status update).
 */
export async function acceptContract(db: Database, userId: string, contractId: string, vehicleId: string, now = new Date()) {
  const company = await companyForUser(db, userId);
  const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, contractId) });
  if (!contract || contract.status !== 'open' || contract.expiresAt <= now) fail('contract_unavailable', 'Поръчката вече не е налична.', 409);
  const { vehicle } = await vehicleBundle(db, company.id, vehicleId);
  if (vehicle.status !== 'idle') fail('vehicle_busy', 'Превозното средство е заето.', 409);

  // Network work outside the transaction (may take seconds).
  const loadedRoute = await db.query.routes.findFirst({ where: (r, { eq: e }) => e(r.id, contract!.routeId) });
  const emptyRoute = vehicle.cityId !== contract!.originCityId ? await getRoute(db, vehicle.cityId, contract!.originCityId, 'truck') : null;

  return db.transaction(async (tx) => {
    const [user] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
    const bundle = await vehicleBundle(tx, company.id, vehicleId, true);
    const error = compatibilityError(
      { modelId: bundle.vehicle.modelId, trailerModelId: bundle.trailer?.modelId ?? null, condition: bundle.vehicle.condition, hasDriver: !!bundle.driver, status: bundle.vehicle.status },
      contract!,
      user?.level ?? 1,
    );
    if (error) fail('incompatible', error);
    if (bundle.vehicle.cityId !== (emptyRoute ? emptyRoute.fromCityId : contract!.originCityId)) fail('vehicle_moved', 'Превозното средство смени местоположението си. Опитайте отново.', 409);

    const claimed = await tx
      .update(contracts)
      .set({ status: 'accepted', acceptedByCompanyId: company.id, acceptedAt: now })
      .where(and(eq(contracts.id, contractId), eq(contracts.status, 'open'), sql`${contracts.expiresAt} > ${now}`))
      .returning({ id: contracts.id });
    if (!claimed.length) fail('contract_unavailable', 'Друга компания току-що пое тази поръчка.', 409);

    const unit = powerUnitModel(bundle.vehicle.modelId);
    const trailer = bundle.trailer ? trailerModel(bundle.trailer.modelId) : null;
    const speedFactor = unit.kind === 'van' ? 1.15 : 1;
    const schedule = buildGameSchedule({
      startAt: now.getTime(),
      empty: emptyRoute ? { km: emptyRoute.distanceKm, durationS: emptyRoute.durationS, borderKms: emptyRoute.borders.map((b) => b.km) } : null,
      loaded: { km: loadedRoute!.distanceKm, durationS: loadedRoute!.durationS, borderKms: loadedRoute!.borders.map((b) => b.km) },
      speedFactor,
      timeScale: timeScale(),
    });
    const rented = bundle.vehicle.ownership === 'rented';
    const totalKm = (emptyRoute?.distanceKm ?? 0) + loadedRoute!.distanceKm;
    const running = tripCosts({
      unit,
      trailer,
      upgrades: bundle.vehicle.upgrades,
      condition: bundle.vehicle.condition,
      driverSkill: bundle.driver!.skill,
      emptyKm: emptyRoute?.distanceKm ?? 0,
      loadedKm: loadedRoute!.distanceKm,
      tons: contract!.weightTons,
      payloadTons: combinationCapability({ unit, trailer }).payloadTons,
      tolledRoute: { empty: emptyRoute?.hasToll ?? false, loaded: loadedRoute!.hasToll },
    });
    // Rented vehicles: the rental company covers fuel, tolls, maintenance and wear for a fee.
    const costs = rented ? { fuelCents: 0, tollCents: 0, maintenanceCents: 0, totalCents: 0, wear: 0 } : running;
    // Company members get a cheaper rental through the company's rental partner.
    const perks = rented ? await bonusesForUser(tx, userId) : null;
    const rentalFee = rented ? rentalFeeCents(contract!.rewardCents, totalKm, perks?.bonuses.rentalShareReduction ?? 0) : null;

    const [delivery] = await tx
      .insert(deliveries)
      .values({
        contractId,
        companyId: company.id,
        vehicleId,
        trailerId: bundle.trailer?.id ?? null,
        driverId: bundle.driver!.id,
        emptyRouteId: emptyRoute?.id ?? null,
        routeId: loadedRoute!.id,
        emptyKm: emptyRoute?.distanceKm ?? 0,
        loadedKm: loadedRoute!.distanceKm,
        schedule,
        estimatedCosts: costs,
        rentalFeeCents: rentalFee,
        scheduleVersion: SCHEDULE_VERSION,
        startedAt: now,
        etaAt: new Date(scheduleEnd(schedule)),
        deadlineAt: new Date(now.getTime() + (contract!.windowMinutes * 60_000) / timeScale()),
      })
      .returning();
    await tx.update(vehicles).set({ status: 'on_delivery' }).where(eq(vehicles.id, vehicleId));
    await logActivity(tx, userId, 'contract_accepted', { contractId, vehicleId, deliveryId: delivery!.id });
    await broadcast(tx, 'market');
    await broadcast(tx, 'world');
    return delivery!;
  });
}

type DeliveryRow = typeof deliveries.$inferSelect;

/** Settles one finished delivery exactly once. Returns false if it was not due or already settled. */
export async function settleDelivery(tx: Tx, deliveryId: string, now = new Date()): Promise<boolean> {
  const [d] = await tx
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'in_progress'), lte(deliveries.etaAt, now)))
    .for('update', { skipLocked: true });
  if (!d) return false;
  const contract = (await tx.query.contracts.findFirst({ where: eq(contracts.id, d.contractId) }))!;
  const [company] = await tx.select().from(companies).where(eq(companies.id, d.companyId));
  const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, d.vehicleId));
  const costs = d.estimatedCosts as ReturnType<typeof tripCosts>;
  const completedAt = d.etaAt; // the truck arrived at ETA even if we settle later
  const result = settle(contract.rewardCents, d.startedAt.getTime(), d.deadlineAt.getTime(), completedAt.getTime());
  const [dest] = await tx.select().from(cities).where(eq(cities.id, contract.destCityId));
  const key = (k: string) => `delivery:${d.id}:${k}`;

  const postings: Posting[] = [
    { category: 'freight', amountCents: result.rewardCents, description: `${contract.goods} → ${dest!.nameBg}`, idempotencyKey: key('freight'), refType: 'delivery', refId: d.id },
    { category: 'fuel', amountCents: -costs.fuelCents, description: `Гориво (${Math.round(d.emptyKm + d.loadedKm)} км)`, idempotencyKey: key('fuel'), refType: 'delivery', refId: d.id },
    { category: 'maintenance', amountCents: -costs.maintenanceCents, description: 'Поддръжка по курса', idempotencyKey: key('maintenance'), refType: 'delivery', refId: d.id },
  ];
  if (costs.tollCents) postings.push({ category: 'tolls', amountCents: -costs.tollCents, description: 'Пътни такси', idempotencyKey: key('tolls'), refType: 'delivery', refId: d.id });
  if (result.bonusCents) postings.push({ category: 'bonus', amountCents: result.bonusCents, description: 'Бонус за ранна доставка', idempotencyKey: key('bonus'), refType: 'delivery', refId: d.id });
  if (d.rentalFeeCents) postings.push({ category: 'rental', amountCents: -d.rentalFeeCents, description: `Наем на камиона (${Math.round(d.emptyKm + d.loadedKm)} км)`, idempotencyKey: key('rental'), refType: 'delivery', refId: d.id });
  if (result.penaltyCents) postings.push({ category: 'penalty', amountCents: -result.penaltyCents, description: 'Неустойка за закъснение', idempotencyKey: key('penalty'), refType: 'delivery', refId: d.id });
  // Company membership: bonus from the company's upgrades and a contribution to its treasury.
  const perks = await bonusesForUser(tx, company!.ownerId);
  const companyBonus = perks ? Math.round(result.rewardCents * (perks.bonuses.rewardMultiplier - 1)) : 0;
  const ownCompany = perks?.membership.company.id === d.companyId;
  const contribution = perks && !ownCompany ? Math.round(result.rewardCents * perks.membership.company.contributionRate) : 0;
  if (companyBonus) postings.push({ category: 'company_bonus', amountCents: companyBonus, description: `Бонус от „${perks!.membership.company.name}“`, idempotencyKey: key('company-bonus'), refType: 'delivery', refId: d.id });
  if (contribution) postings.push({ category: 'company_contribution', amountCents: -contribution, description: `Вноска към „${perks!.membership.company.name}“`, idempotencyKey: key('contribution'), refType: 'delivery', refId: d.id });
  await post(tx, d.companyId, postings.filter((p) => p.amountCents !== 0));
  if (contribution) {
    const [member] = await tx.select({ username: users.username }).from(users).where(eq(users.id, company!.ownerId));
    await post(tx, perks!.membership.company.id, [
      { category: 'member_contributions', amountCents: contribution, description: `Вноска от ${member!.username}`, idempotencyKey: key('contribution-in'), refType: 'delivery', refId: d.id },
    ]);
  }

  const payout = result.rewardCents + result.bonusCents - result.penaltyCents - costs.totalCents - (d.rentalFeeCents ?? 0) + companyBonus - contribution;
  const onTime = !result.late;
  const baseXp = deliveryXp(d.loadedKm, contract.weightTons, onTime, upgradeFactor(vehicle!.upgrades, 'xp'));
  const xp = Math.round(baseXp * (perks?.bonuses.xpMultiplier ?? 1));
  if (perks) {
    await tx
      .update(companyMembers)
      .set({ deliveries: sql`${companyMembers.deliveries} + 1`, contributedCents: sql`${companyMembers.contributedCents} + ${contribution}`, xpContributed: sql`${companyMembers.xpContributed} + ${baseXp}` })
      .where(eq(companyMembers.userId, company!.ownerId));
    await addCompanyXp(tx, perks.membership.company.id, baseXp);
  }

  await tx
    .update(deliveries)
    .set({ status: 'completed', completedAt, late: result.late, payoutCents: payout, xpAwarded: xp })
    .where(eq(deliveries.id, d.id));
  await tx
    .update(vehicles)
    .set({ status: 'idle', cityId: contract.destCityId, condition: sql`greatest(0, ${vehicles.condition} - ${costs.wear})`, odometerKm: sql`${vehicles.odometerKm} + ${d.emptyKm + d.loadedKm}` })
    .where(eq(vehicles.id, d.vehicleId));
  if (d.trailerId) await tx.update(trailers).set({ cityId: contract.destCityId, condition: sql`greatest(0, ${trailers.condition} - ${costs.wear * 0.6})` }).where(eq(trailers.id, d.trailerId));
  // Drivers grow with experience: one skill level per 8 000 XP, never downwards.
  await tx
    .update(drivers)
    .set({ xp: sql`${drivers.xp} + ${xp}`, skill: sql`greatest(${drivers.skill}, least(5, 1 + floor((${drivers.xp} + ${xp}) / 8000.0)::int))` })
    .where(eq(drivers.id, d.driverId));
  await tx
    .update(companies)
    .set({
      deliveries: sql`${companies.deliveries} + 1`,
      onTimeDeliveries: sql`${companies.onTimeDeliveries} + ${onTime ? 1 : 0}`,
      totalKm: sql`${companies.totalKm} + ${d.emptyKm + d.loadedKm}`,
      reputation: reputationAfter(company!.reputation, onTime),
    })
    .where(eq(companies.id, d.companyId));

  // Shared economy: deliveries saturate the destination market for everyone.
  await tx
    .update(cityMarkets)
    .set({ demand: sql`greatest(${ECONOMY.demandFloor}, ${cityMarkets.demand} - ${contract.weightTons * ECONOMY.demandDropPerTon})`, updatedAt: now })
    .where(and(eq(cityMarkets.cityId, contract.destCityId), eq(cityMarkets.cargoType, contract.cargoType)));

  await awardXp(tx, company!.ownerId, xp);
  await addSeasonScore(tx, d.companyId, seasonPoints(d.loadedKm, contract.weightTons, onTime), result.rewardCents, now);
  await notify(
    tx,
    company!.ownerId,
    onTime ? 'success' : 'warning',
    onTime ? `Доставено: ${contract.goods} в ${dest!.nameBg}` : `Закъсняла доставка в ${dest!.nameBg}`,
    `Нетен резултат ${(payout / 100).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} €, +${xp} опит.`,
    '/game/finance',
  );
  await checkAchievements(tx, company!.ownerId, d.companyId);
  return true;
}

/** Settles every delivery whose ETA has passed. Safe to run concurrently (row locks + status checks). */
export async function settleDueDeliveries(db: Database, now = new Date(), companyId?: string): Promise<number> {
  const conditions = [eq(deliveries.status, 'in_progress'), lte(deliveries.etaAt, now)];
  if (companyId) conditions.push(eq(deliveries.companyId, companyId));
  const due = await db.select({ id: deliveries.id }).from(deliveries).where(and(...conditions)).orderBy(asc(deliveries.etaAt)).limit(200);
  let settled = 0;
  for (const { id } of due) if (await db.transaction((tx) => settleDelivery(tx, id, now))) settled++;
  if (settled) {
    await broadcast(db, 'leaderboard');
    await broadcast(db, 'world');
  }
  return settled;
}

export async function activeDeliveries(db: DbOrTx, companyId: string) {
  return deliveryViews(db, and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'in_progress'))!, 50);
}

export async function recentDeliveries(db: DbOrTx, companyId: string, limit = 20) {
  return deliveryViews(db, and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'completed'))!, limit, true);
}

async function deliveryViews(db: DbOrTx, where: ReturnType<typeof and>, limit: number, newestFirst = false) {
  const rows: DeliveryRow[] = await db.select().from(deliveries).where(where).orderBy(newestFirst ? desc(deliveries.completedAt) : asc(deliveries.etaAt)).limit(limit);
  if (!rows.length) return [];
  const contractRows = await db.select().from(contracts).where(inArray(contracts.id, rows.map((r) => r.contractId)));
  const cityIds = [...new Set(contractRows.flatMap((c) => [c.originCityId, c.destCityId]))];
  const cityRows = await db.select().from(cities).where(inArray(cities.id, cityIds));
  const vehicleRows = await db.select().from(vehicles).where(inArray(vehicles.id, rows.map((r) => r.vehicleId)));
  const cMap = new Map(contractRows.map((c) => [c.id, c]));
  const cityMap = new Map(cityRows.map((c) => [c.id, c]));
  const vMap = new Map(vehicleRows.map((v) => [v.id, v]));
  return rows.map((d) => {
    const contract = cMap.get(d.contractId)!;
    return { ...d, schedule: d.schedule as Segment[], contract, origin: cityMap.get(contract.originCityId)!, destination: cityMap.get(contract.destCityId)!, vehicle: vMap.get(d.vehicleId)! };
  });
}

export type DeliveryView = Awaited<ReturnType<typeof activeDeliveries>>[number];

/** Hourly drift of the shared market back toward neutral demand. */
export async function recoverDemand(db: DbOrTx, hours: number) {
  const step = ECONOMY.demandRecoveryPerHour * hours;
  await db.execute(sql`
    update city_markets set demand = case
      when demand < 1 then least(1, demand + ${step})
      when demand > 1 then greatest(1, demand - ${step})
      else demand end, updated_at = now()
    where demand <> 1`);
}

/**
 * Keeps running deliveries on the current game-time rules: deliveries started
 * under an older schedule version (real time, or a previous GAME_TIME) are
 * rescaled from their start, and open contracts get the current windows.
 * Idempotent — safe to call on every worker tick.
 */
export async function migrateToGameTime(db: Database): Promise<number> {
  const legacy = await db.select().from(deliveries).where(and(eq(deliveries.status, 'in_progress'), lt(deliveries.scheduleVersion, SCHEDULE_VERSION))).limit(200);
  for (const d of legacy) {
    const contract = (await db.query.contracts.findFirst({ where: eq(contracts.id, d.contractId) }))!;
    const schedule = compressSchedule(d.schedule as Segment[], d.startedAt.getTime(), gameDurationMinutes(d.emptyKm + d.loadedKm));
    await db
      .update(deliveries)
      .set({ schedule, etaAt: new Date(scheduleEnd(schedule)), deadlineAt: new Date(d.startedAt.getTime() + contractWindowMinutes(contract.distanceKm) * 60_000), scheduleVersion: SCHEDULE_VERSION })
      .where(and(eq(deliveries.id, d.id), lt(deliveries.scheduleVersion, SCHEDULE_VERSION)));
  }
  const open = await db.select({ id: contracts.id, distanceKm: contracts.distanceKm, windowMinutes: contracts.windowMinutes }).from(contracts).where(eq(contracts.status, 'open'));
  for (const c of open) {
    const window = contractWindowMinutes(c.distanceKm);
    if (c.windowMinutes > window) await db.update(contracts).set({ windowMinutes: window }).where(eq(contracts.id, c.id));
  }
  return legacy.length;
}
