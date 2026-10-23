import { and, asc, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { CARGO, canCarry, type CargoType } from '@/lib/game/cargo';
import { combinationCapability, hasWinterGrip, powerUnitModel, TRAILER_UPGRADES, trailerModel } from '@/lib/game/catalog';
import { ECONOMY, rentalFeeCents, settle, tripCosts, upgradeFactor } from '@/lib/game/economy';
import { fuelPriceCents, legFuelPriceCents } from '@/lib/game/fuel';
import { planRoadEvents } from '@/lib/game/road-events';
import { CONVOY_RULES } from '@/lib/game/convoy';
import { MULTISTOP, stopPenaltyCents, type ContractStop } from '@/lib/game/multistop';
import { formConvoy } from './convoy';
import { isEuropeCountry } from '@/lib/geo/scope';
import { bigConvoyBonus, checkEurotour } from './challenges';
import { specializationBonus } from './specialization';
import { checkLegend } from './heritage';
import { firstTripBonus, recordLaneRun, settlePerfectConvoy } from './community';
import { featureFor } from '@/server/features';
import { maintenanceState } from '@/lib/game/maintenance';
import { acceptJobOffer, payHireCommission } from './hire';
import { mentorXpFactor } from './mentor';
import { recordBattleDelivery } from './battles';
import { boomFor, recordMaterialDelivery } from './plot';
import { BOOM } from '@/lib/game/plot';
import { recordWeeklyGoal } from './weekly-goal';
import { addFeed, FEED_LONG_TRIP_KM } from './feed';
import { recordProjectDelivery } from './projects';
import { isWinter, routeCondition, WINTER } from '@/lib/game/winter';
import { CREW_RULES, crewEffects } from '@/lib/game/crew';
import { canOverload, FINE_RULES, overloadPercent, type Violation } from '@/lib/game/fines';
import { COMPANY_XP_SHARE, deliveryXp, FLEET_XP_SHARE, reputationAfter, reputationBonusShare, seasonPoints } from '@/lib/game/progression';
import { buildGameTrip, compressSchedule, contractWindowMinutes, gameDurationMinutes, scheduleEnd, SCHEDULE_VERSION, type Segment } from '@/lib/game/schedule';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, cityMarkets, companies, companyBuilds, companyMembers, contracts, deliveries, drivers, routes, trailers, users, vehicles } from '@/server/db/schema';
import { getCrossingRoute, getRoute } from '@/server/geo/route-service';
import { companyForUser } from './company';
import { fail } from './errors';
import { post, postTreasury, type Posting } from './finance';
import { broadcast, logActivity, notify } from './notify';
import { awardXp, checkAchievements } from './progression';
import { heldLicences, licenceNames, missingFor } from './licences';
import { addCompanyXp, bonusesForUser, membershipOf } from './membership';
import { recordCompanyMissionProgress } from './company-missions';
import { recordEventProgress } from './events';
import { recordMissionProgress } from './missions';
import { afterRentedTrip } from './rentals';
import { checkTenderLoad, recordTenderLoad } from './tenders';
import { isVip, VIP_PERKS } from '@/lib/game/vip';
import { contractCountries } from '@/lib/game/licences';
import { addOrganizationSeasonScore, addSeasonScore } from './seasons';
import { rewardReferral } from './referrals';
import { addLeaguePoints } from './leagues';
import { addPassPoints } from './season-pass';
import { settleExchange, settleTradeLot } from './trade';
import { applyRoadEvents } from './road-events';
import { recordClientLoad } from './clients';
import { deliverAuctionLoad } from './auctions';
import { recordHalloweenDelivery } from './halloween';
import { recordChristmasDelivery } from './christmas';
import { isChristmas } from '@/lib/game/christmas';
import { isMarta } from '@/lib/game/marta';
import { recordMartaDelivery } from './marta';
import { isEaster } from '@/lib/game/easter';
import { recordEasterDelivery } from './easter';
import { HALLOWEEN, isHalloween } from '@/lib/game/halloween';
import { canSplit, partError, partRewardCents } from '@/lib/game/partial';
import { BOARDING_GAME_MIN, CROSSING_LINES, crossingLine as crossingLine_, crossingNote, DEPARTURE_EVERY_MIN, onBoardGameMinutes, railOptions } from '@/lib/game/crossings';
import { checkSharedLoad, deliverDailyLoad, recordDuelDelivery, settleSharedPart } from './together';
import { recordShipContainer } from './ports';
import { recordRallyRun } from './rally';
import { activeRoadWorks } from './roads';
import { recordCityVisit, recordPerfectTrip } from './competition';
import { clientsOf, fuelStationAt, payCompanyContract, recordAcademyCourse, allianceHallBonus, recordAllianceDelivery, recordHallDelivery } from './alliances';
import { FUEL_STATION } from '@/lib/game/alliances';
import { CARGO_INSURANCE, isNightShift, NIGHT, OVERSIZE, oversizeCostCents, roadWorksFactor, applyRushHour } from '@/lib/game/roads';
import { companyTrailerBonus } from './company-trailers';
import { COMPANY_TRAILERS } from '@/lib/game/company-fleet';
import { applyBorderQueues, REFUEL, refuelPriceCents, SECURE_PARKING, trafficFactor } from '@/lib/game/traffic';
import { applyDrivingBans, countryTollCents, lezFeeCents } from '@/lib/game/europe-roads';
import { recordFactoryDelivery } from './factory';
import { branchBonus } from './business';
import { realConditionsFor } from './weather';
import { onVacation } from './moods';
import { equinoxBonus, recordPassOpening } from './spring';

const timeScale = () => Math.max(1, Number(process.env.GAME_TIME_SCALE ?? 1));

/** Validates that a vehicle (with its trailer and driver) can legally take a contract. */
export function compatibilityError(
  input: { modelId: string; trailerModelId: string | null; condition: number; hasDriver: boolean; status: string; trailerCondition?: number | null },
  contract: { cargoType: string; weightTons: number; minLevel: number },
  level: number,
  /** The player chose to load up to 10 % over the payload (risk of a fine). */
  overload = false,
): string | null {
  const unit = powerUnitModel(input.modelId);
  const trailer = input.trailerModelId ? trailerModel(input.trailerModelId) : null;
  const cargo = contract.cargoType as CargoType;
  if (input.status === 'listed') return 'Обявено за продажба — свали обявата, за да кара.';
  if (input.status !== 'idle') return 'Превозното средство е заето.';
  if (!input.hasDriver) return 'Няма назначен шофьор.';
  if (unit.kind === 'tractor' && !trailer) return 'Влекачът няма прикачено ремарке.';
  const cap = combinationCapability({ unit, trailer });
  if (!canCarry(cap.bodies, cargo)) return `Нужна е надстройка: ${CARGO[cargo].bodies.map((b) => BODY_LABELS[b]).join(' или ')}.`;
  if (contract.weightTons > cap.payloadTons && !(overload && canOverload(contract.weightTons, cap.payloadTons))) {
    return `Товарът (${contract.weightTons} т) надвишава капацитета (${cap.payloadTons} т)${canOverload(contract.weightTons, cap.payloadTons) ? ' — може само с претоварване' : ''}.`;
  }
  if (input.condition < ECONOMY.minConditionForJobs) return 'Техниката е в лошо състояние — нужен е ремонт.';
  if (trailer && input.trailerCondition != null && input.trailerCondition < ECONOMY.minConditionForJobs) return 'Ремаркето е в лошо състояние — нужен е ремонт.';
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
  flatbed: 'платформа',
  car_carrier: 'автовоз',
};

async function vehicleBundle(db: DbOrTx, companyId: string, vehicleId: string, lock = false) {
  const q = db.select().from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, companyId)));
  const [vehicle] = lock ? await q.for('update') : await q;
  if (!vehicle) fail('vehicle_not_found', 'Превозното средство не е намерено.', 404);
  const [trailer] = await db.select().from(trailers).where(eq(trailers.vehicleId, vehicleId));
  const [driver] = await db.select().from(drivers).where(eq(drivers.vehicleId, vehicleId));
  const [coDriver] = await db.select().from(drivers).where(eq(drivers.coVehicleId, vehicleId));
  return { vehicle: vehicle!, trailer: trailer ?? null, driver: driver ?? null, coDriver: coDriver ?? null };
}

/** Urgent shipments: the empty run to the pickup city takes this long, wherever the truck is. */
export const URGENT_RELOCATION_MS = 60_000;

/**
 * Player accepts a market contract with one of their vehicles. Routes are
 * resolved first (network), then everything is committed atomically. An
 * ordinary contract has one winner (conditional status update); an urgent one
 * stays open until it expires and every player may take it once.
 */
export async function acceptContract(db: Database, userId: string, contractId: string, vehicleId: string, now = new Date(), risks: { rush?: boolean; overload?: boolean; tons?: number; rail?: string; insure?: boolean; route?: 'fast' | 'cheap'; parking?: 'secure' | 'free'; refuel?: boolean } = {}) {
  const company = await companyForUser(db, userId);
  const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, contractId) });
  // Own goods (trading) are hauled only by their owner and never appear on the board.
  // Own goods hauled by their owner are private ('trade'); own goods on the freight exchange (v1.4) are on the board.
  const openStatus = contract?.tradeCompanyId && !contract.exchange ? 'trade' : 'open';
  if (!contract || contract.status !== openStatus || contract.expiresAt <= now) fail('contract_unavailable', 'Поръчката вече не е налична.', 409);
  if (contract!.tradeCompanyId && !contract!.exchange && contract!.tradeCompanyId !== company.id) fail('contract_unavailable', 'Поръчката вече не е налична.', 409);
  if (contract!.exchange && contract!.tradeCompanyId === company.id) fail('own_offer', 'Това е твоята стока — изчакай превозвач или я откарай сам от „Търговия“.');
  if (contract!.exchange && !(await featureFor(db, userId, 'freight_exchange', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  const { vehicle } = await vehicleBundle(db, company.id, vehicleId);
  if (vehicle.status !== 'idle') fail('vehicle_busy', 'Превозното средство е заето.', 409);
  if (vehicle.movingUntil && vehicle.movingUntil > now) fail('moving', 'Камионът още пътува до депото — след минута.', 409);
  // Groupage loads come with v1.2 (staff test them before the release).
  if (contract!.stops?.length && !(await featureFor(db, userId, 'multistop', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  // Partial load (v1.3): only part of an ordinary board load, for the same pay per tonne.
  const partial = risks.tons != null && risks.tons < contract!.weightTons;
  if (partial && !(await featureFor(db, userId, 'partial_loads', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  if (partial && !canSplit(contract!)) fail('no_partial', 'Тази поръчка се взима само цяла.');
  if (contract!.featured && !(await featureFor(db, userId, 'daily_load', now))) fail('not_released', 'Това идва със следващото обновление.', 403);

  // Network work outside the transaction (may take seconds).
  let loadedRoute = await db.query.routes.findFirst({ where: (r, { eq: e }) => e(r.id, contract!.routeId) });
  // v1.4: the truck may ride a train for the long part ("С влак"); islands are reached by ferry.
  if (risks.rail) {
    if (!(await featureFor(db, userId, 'rail', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
    const [lineId = '', dir] = risks.rail.split(':');
    const ends = await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, [contract!.originCityId, contract!.destCityId, ...CROSSING_LINES.filter((l) => l.kind === 'rail').flatMap((l) => [l.a, l.b])]));
    const at = new Map(ends.map((c) => [c.id, c]));
    const option = railOptions(at.get(contract!.originCityId)!, at.get(contract!.destCityId)!, at).find((o) => o.line.id === lineId && o.reversed === (dir === 'r'));
    if (!option || contract!.stops?.length || contract!.urgent) fail('no_rail', 'Влакът не е подходящ за този товар.');
    loadedRoute = await getCrossingRoute(db, contract!.originCityId, contract!.destCityId, option!.line, option!.reversed, 'truck');
  }
  // v1.6: the cheap way — off the motorways, no tolls, slower (ordinary loads only).
  if (risks.route === 'cheap' && !risks.rail && !contract!.stops?.length && !contract!.urgent && !loadedRoute?.crossing) {
    if (!(await featureFor(db, userId, 'route_choice', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
    loadedRoute = await getRoute(db, contract!.originCityId, contract!.destCityId, 'truck_cheap');
  }
  const crossingLine = loadedRoute?.crossing ? crossingLine_(loadedRoute.crossing.lineId) : null;
  if (crossingLine?.kind === 'ferry' && !(await featureFor(db, userId, 'ferries', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  // "Цяла Европа" (v1.7): the new countries wait for the release (the staff test them earlier).
  const ends17 = await db.select({ country: cities.countryCode }).from(cities).where(inArray(cities.id, [contract!.originCityId, contract!.destCityId, ...(contract!.stops ?? []).map((st) => st.cityId)]));
  if (ends17.some((c) => isEuropeCountry(c.country)) && !(await featureFor(db, userId, 'europe', now))) fail('not_released', 'Тези държави идват със следващото обновление.', 403);
  const emptyRoute = vehicle.cityId !== contract!.originCityId ? await getRoute(db, vehicle.cityId, contract!.originCityId, 'truck') : null;

  return db.transaction(async (tx) => {
    const [user] = await tx.select({ level: users.level, vipUntil: users.vipUntil }).from(users).where(eq(users.id, userId));
    const vip = isVip(user?.vipUntil, now);
    const bundle = await vehicleBundle(tx, company.id, vehicleId, true);
    // A partial load re-reads the load under a lock: another truck may have just taken a part of it.
    let load = contract!;
    if (partial) {
      const [fresh] = await tx.select().from(contracts).where(and(eq(contracts.id, contractId), eq(contracts.status, 'open'), sql`${contracts.expiresAt} > ${now}`)).for('update');
      if (!fresh) fail('contract_unavailable', 'Друга компания току-що пое тази поръчка.', 409);
      const capacity = combinationCapability({ unit: powerUnitModel(bundle.vehicle.modelId), trailer: bundle.trailer ? trailerModel(bundle.trailer.modelId) : null }).payloadTons;
      const tons = Math.round(risks.tons! * 10) / 10;
      const wrong = partError(fresh!.weightTons, tons, capacity);
      if (wrong) fail('bad_part', wrong);
      load = { ...fresh!, weightTons: tons, rewardCents: partRewardCents(fresh!, tons) };
    }
    const error = compatibilityError(
      { modelId: bundle.vehicle.modelId, trailerModelId: bundle.trailer?.modelId ?? null, condition: bundle.vehicle.condition, hasDriver: !!bundle.driver, status: bundle.vehicle.status, trailerCondition: bundle.trailer?.condition ?? null },
      load,
      user?.level ?? 1,
      !partial && !!risks.overload,
    );
    if (error) fail('incompatible', error);
    // A driver on a day off does not drive (v1.4).
    if (onVacation(bundle.driver, now) || onVacation(bundle.coDriver, now)) fail('vacation', 'Шофьорът е в почивен ден — назначи друг или изчакай.');
    const [from] = await tx.select({ country: cities.countryCode }).from(cities).where(eq(cities.id, contract!.originCityId));
    const [parked] = await tx.select({ country: cities.countryCode }).from(cities).where(eq(cities.id, bundle.vehicle.cityId));
    const [to] = await tx.select({ country: cities.countryCode }).from(cities).where(eq(cities.id, contract!.destCityId));
    const missing = missingFor({ cargoType: contract!.cargoType, originCountry: from!.country, destCountry: to!.country, routeCountries: loadedRoute!.countries }, await heldLicences(tx, userId));
    if (missing.length) fail('licence_required', `Нужен е лиценз: ${licenceNames(missing)}. Купува се от раздел „Лицензи“.`);
    if (bundle.vehicle.cityId !== (emptyRoute ? emptyRoute.fromCityId : contract!.originCityId)) fail('vehicle_moved', 'Превозното средство смени местоположението си. Опитайте отново.', 409);

    // VIP early access to urgent shipments.
    if (contract!.urgent && !vip && now.getTime() < contract!.createdAt.getTime() + VIP_PERKS.urgentEarlyMs) {
      fail('vip_early_access', `Спешната поръчка се отваря за всички в ${new Date(contract!.createdAt.getTime() + VIP_PERKS.urgentEarlyMs).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Sofia' })}. VIP играчите я виждат 5 минути по-рано.`, 409);
    }
    // A contract reserved by a VIP is theirs until the reservation ends.
    if (contract!.reservedUntil && contract!.reservedUntil > now && contract!.reservedByCompanyId !== company.id) fail('reserved', 'Поръчката е запазена от друг играч за няколко минути.', 409);
    // Premium contracts need reputation.
    if (contract!.minReputation > 0) {
      const [acct] = await tx.select({ reputation: companies.reputation }).from(companies).where(eq(companies.id, company.id));
      if ((acct?.reputation ?? 0) < contract!.minReputation) fail('reputation_required', `Премиум поръчка: нужна е репутация ${contract!.minReputation} (твоята е ${Math.floor(acct?.reputation ?? 0)}). Репутацията расте с доставки навреме.`);
    }
    // Tender loads: only members of the company that runs the tender.
    if (contract!.tenderId) await checkTenderLoad(tx, contract!.tenderId, userId, now);
    // A load shared with a company: only its members.
    if (contract!.sharedLoadId) await checkSharedLoad(tx, contract!.sharedLoadId, userId);
    // Building materials and factory loads: only the members of that company.
    if (contract!.rallyId && contract!.createdBy !== userId) fail('not_yours', 'Това е ралито на друг играч.', 403);
    if (contract!.factoryOrgId || contract!.constructionId || contract!.branchOrgId) {
      const mine = (await membershipOf(tx, userId))?.company.id ?? null;
      const [build] = contract!.constructionId ? await tx.select({ org: companyBuilds.organizationId }).from(companyBuilds).where(eq(companyBuilds.id, contract!.constructionId)) : [];
      // A hauling contract (v1.5): the hauler company's members may take the client's factory and branch loads.
      const clients = mine && (contract!.factoryOrgId || contract!.branchOrgId) && (await featureFor(tx, userId, 'company_contracts', now)) ? await clientsOf(tx, mine, now) : [];
      const ok = (org: string | null) => !org || org === mine || clients.includes(org);
      if (!ok(contract!.factoryOrgId) || !ok(contract!.branchOrgId) || (contract!.constructionId && build?.org !== mine)) fail('members_only', 'Този товар е само за членовете на компанията.', 403);
    }
    let loadId = contractId;
    if (contract!.urgent) {
      // Open to everyone until it expires — each player once.
      const [still] = await tx.select({ id: contracts.id }).from(contracts).where(and(eq(contracts.id, contractId), eq(contracts.status, 'open'), sql`${contracts.expiresAt} > ${now}`)).for('share');
      if (!still) fail('contract_unavailable', 'Спешната поръчка вече изтече.', 409);
      const [mine] = await tx.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.contractId, contractId), eq(deliveries.companyId, company.id)));
      if (mine) fail('already_taken', 'Вече сте поели тази спешна поръчка.', 409);
    } else if (partial) {
      // The part becomes a load of its own; the rest stays on the board with the rest of the pay.
      const { id: _whole, ...copy } = load;
      const [part] = await tx.insert(contracts).values({ ...copy, status: 'accepted', acceptedByCompanyId: company.id, acceptedAt: now, reservedByCompanyId: null, reservedUntil: null }).returning({ id: contracts.id });
      await tx.update(contracts).set({ weightTons: sql`round((${contracts.weightTons} - ${load.weightTons})::numeric, 1)::real`, rewardCents: sql`${contracts.rewardCents} - ${load.rewardCents}` }).where(eq(contracts.id, contractId));
      loadId = part!.id;
    } else {
      const claimed = await tx
        .update(contracts)
        .set({ status: 'accepted', acceptedByCompanyId: company.id, acceptedAt: now })
        .where(and(eq(contracts.id, contractId), eq(contracts.status, openStatus), sql`${contracts.expiresAt} > ${now}`))
        .returning({ id: contracts.id });
      if (!claimed.length) fail('contract_unavailable', 'Друга компания току-що пое тази поръчка.', 409);
    }

    const unit = powerUnitModel(bundle.vehicle.modelId);
    const trailer = bundle.trailer ? trailerModel(bundle.trailer.modelId) : null;
    const speedFactor = unit.kind === 'van' ? 1.15 : 1;
    // Electric (v1.4): a fast charge at about 90 % of the range.
    const charging = unit.electric ? { everyKm: Math.round(unit.electric.rangeKm * 0.9), minutes: unit.electric.chargeMin } : undefined;
    if (unit.electric && !(await featureFor(tx, userId, 'electric', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
    // The crew: hours left from the last trip, a second driver, skills.
    const rested = crewEffects(bundle.driver!, bundle.coDriver, now);
    // Risks the player chose: drive on without the due rest, load over the payload.
    const violations: { violation: Violation; amount: number }[] = [];
    if (risks.rush && rested.startDutyMin > 0) violations.push({ violation: 'hours', amount: rested.startDutyMin / 60 });
    const payload = combinationCapability({ unit: powerUnitModel(bundle.vehicle.modelId), trailer: bundle.trailer ? trailerModel(bundle.trailer.modelId) : null }).payloadTons;
    const overloaded = overloadPercent(load.weightTons, payload);
    if (overloaded > 0) violations.push({ violation: 'overload', amount: overloaded });
    const crew = { ...rested, startDutyMin: risks.rush ? 0 : rested.startDutyMin, wear: rested.wear * (overloaded > 0 ? FINE_RULES.overloadWear : 1) };
    const crossing = loadedRoute!.crossing && crossingLine
      ? { kind: crossingLine.kind, fromKm: loadedRoute!.crossing.fromKm, toKm: loadedRoute!.crossing.toKm, realMin: crossingLine.hours * 60, gameMin: onBoardGameMinutes(crossingLine), boardingMin: BOARDING_GAME_MIN, everyMin: DEPARTURE_EVERY_MIN[crossingLine.kind], note: crossingNote(crossingLine, loadedRoute!.profile.endsWith(':r')) }
      : undefined;
    const loadedLeg = { km: loadedRoute!.distanceKm, durationS: loadedRoute!.durationS, borderKms: loadedRoute!.borders.map((b) => b.km), stops: contract!.stops?.map((st) => ({ km: st.km, minutes: MULTISTOP.unloadMin })), crossing };
    // On board there is no fuel, toll or wear: the road part is what the truck drives.
    const roadLoadedKm = loadedRoute!.distanceKm - (crossing ? crossing.toKm - crossing.fromKm : 0);
    // v1.5: a night start is faster, road works on the way and an oversize load slower.
    if (contract!.oversize && !(await featureFor(tx, userId, 'oversize', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
    const night = !contract!.urgent && isNightShift(now) && (await featureFor(tx, userId, 'night_shift', now));
    const works = (await featureFor(tx, userId, 'road_works', now)) ? await activeRoadWorks(tx, now) : [];
    const roadFactor = roadWorksFactor(loadedRoute!.countries, works);
    // v1.6: many trucks on the same lane right now make it a little slower.
    const [{ onLane = 0 } = {}] = (await featureFor(tx, userId, 'road_traffic', now))
      ? await tx.select({ onLane: sql<number>`count(*)::int` }).from(deliveries).innerJoin(contracts, eq(contracts.id, deliveries.contractId)).where(and(eq(deliveries.status, 'in_progress'), eq(contracts.originCityId, contract!.originCityId), eq(contracts.destCityId, contract!.destCityId)))
      : [];
    const traffic = trafficFactor(onLane + 1);
    // Urgent shipments run faster than normal game time.
    const scale = (timeScale() * Math.max(1, contract!.speedFactor) * (night ? NIGHT.faster : 1) * (contract!.oversize ? OVERSIZE.slower : 1)) / roadFactor / traffic;
    const trip = contract!.urgent
      ? buildGameTrip({ startAt: now.getTime() + (emptyRoute ? URGENT_RELOCATION_MS : 0), empty: null, loaded: loadedLeg, speedFactor, timeScale: scale, crew, charging })
      : buildGameTrip({
          startAt: now.getTime(),
          empty: emptyRoute ? { km: emptyRoute.distanceKm, durationS: emptyRoute.durationS, borderKms: emptyRoute.borders.map((b) => b.km) } : null,
          loaded: loadedLeg,
          speedFactor,
          timeScale: scale,
          crew,
          charging,
        });
    const planned: Segment[] = contract!.urgent
      ? [
          // The truck is moved to the pickup city in one minute, then drives the cargo.
          ...(emptyRoute ? [{ kind: 'drive' as const, leg: 'empty' as const, start: now.getTime(), end: now.getTime() + URGENT_RELOCATION_MS, fromKm: 0, toKm: emptyRoute.distanceKm }] : []),
          ...trip.segments,
        ]
      : trip.segments;
    // Rush hour in big cities (v1.5): slower loading and unloading by the city's own clock.
    let schedule = planned;
    if (await featureFor(tx, userId, 'rush_hour', now)) {
      const ends = await tx.select({ id: cities.id, population: cities.population, timezone: cities.timezone }).from(cities).where(inArray(cities.id, [contract!.originCityId, contract!.destCityId]));
      const o = ends.find((c) => c.id === contract!.originCityId), dst = ends.find((c) => c.id === contract!.destCityId);
      if (o && dst) schedule = applyRushHour(planned, o, dst).segments;
    }
    // Border queues by the day and the hour (v1.6).
    if (await featureFor(tx, userId, 'border_queues', now)) schedule = applyBorderQueues(schedule);
    // Weekend driving bans for heavy trucks (v1.7): the truck waits at the border or the start.
    if (unit.kind !== 'van' && (await featureFor(tx, userId, 'driving_bans', now))) {
      schedule = applyDrivingBans(schedule, { empty: emptyRoute ? { start: parked!.country, borders: emptyRoute.borders } : null, loaded: { start: from!.country, borders: loadedRoute!.borders } }).segments;
    }
    const countryTolls = await featureFor(tx, userId, 'country_tolls', now);
    // The daily rests on the way (v1.6): a guarded car park for a fee, or a free lay-by with a small risk of fuel theft.
    const parkingLive = await featureFor(tx, userId, 'secure_parking', now);
    const rests = parkingLive ? schedule.filter((s) => s.kind === 'rest').length : 0;
    const parkingCents = risks.parking === 'secure' ? rests * SECURE_PARKING.feeCents : 0;
    let theftCents = 0;
    if (risks.parking !== 'secure') for (let i = 0; i < rests; i++) if (Math.random() < SECURE_PARKING.theftChance) theftCents += Math.round(SECURE_PARKING.theftCents[0] + Math.random() * (SECURE_PARKING.theftCents[1] - SECURE_PARKING.theftCents[0]));
    const rented = bundle.vehicle.ownership === 'rented';
    // The urgent one-minute relocation costs nothing; only the cargo leg is paid for.
    const chargedEmptyKm = contract!.urgent ? 0 : (emptyRoute?.distanceKm ?? 0);
    const totalKm = chargedEmptyKm + roadLoadedKm;
    const running = tripCosts({
      unit,
      trailer,
      upgrades: [...bundle.vehicle.upgrades, ...(bundle.trailer?.upgrades ?? [])],
      condition: bundle.vehicle.condition,
      driverSkill: Math.max(bundle.driver!.skill, bundle.coDriver?.skill ?? 0),
      crewFuel: crew.fuel,
      crewWear: crew.wear,
      emptyKm: chargedEmptyKm,
      loadedKm: roadLoadedKm,
      tons: load.weightTons,
      payloadTons: combinationCapability({ unit, trailer }).payloadTons,
      tolledRoute: { empty: !contract!.urgent && (emptyRoute?.hasToll ?? false), loaded: loadedRoute!.hasToll },
      // v1.7: each country's own truck toll (per km, motorway or vignette).
      tollByLeg: countryTolls ? { empty: countryTollCents(parked!.country, chargedEmptyKm, emptyRoute?.borders ?? [], ECONOMY.tollCentsPerKm), loaded: countryTollCents(from!.country, roadLoadedKm, loadedRoute!.borders, ECONOMY.tollCentsPerKm) } : undefined,
      // Diesel is bought along the way: each leg pays the prices of the countries it crosses.
      fuelPrice: {
        empty: legFuelPriceCents(parked!.country, chargedEmptyKm, emptyRoute?.borders ?? [], now),
        // v1.6: the tank filled in the cheapest country on the way, as far as it reaches.
        loaded: risks.refuel && !unit.electric && (await featureFor(tx, userId, 'refuel', now))
          ? refuelPriceCents(legFuelPriceCents(from!.country, roadLoadedKm, loadedRoute!.borders, now), Math.min(...loadedRoute!.countries.map((c) => fuelPriceCents(c, now))), roadLoadedKm, REFUEL.tankLitres[unit.kind] ?? 300, unit.fuelFull)
          : legFuelPriceCents(from!.country, roadLoadedKm, loadedRoute!.borders, now),
      },
    });
    // Rented vehicles: the rental company covers fuel, tolls, maintenance and wear for a fee.
    // The ferry or train ticket is paid by every truck (rented ones too).
    const ticket = crossingLine?.ticketCents ?? 0;
    // An oversize load: the permit and the escort car (v1.5).
    const oversizeCents = contract!.oversize ? oversizeCostCents(roadLoadedKm) : 0;
    // A company fuel station in the start city (v1.5): cheaper fuel for its members; the station earns on the others.
    const station = !rented && !contract!.urgent ? await fuelStationAt(tx, contract!.originCityId, userId, now) : null;
    if (station?.member) {
      const off = Math.round(running.fuelCents * station.discount);
      running.fuelCents -= off;
      running.totalCents -= off;
    }
    // Cargo insurance (v1.5): a share of the pay now, most of a late penalty covered later.
    const insured = !!risks.insure && (await featureFor(tx, userId, 'cargo_insurance', now));
    const cargoInsuranceCents = insured ? Math.round(load.rewardCents * CARGO_INSURANCE.premiumShare) : 0;
    const fuelStation = station && !station.member ? { orgId: station.orgId, cents: Math.round(running.fuelCents * FUEL_STATION.margin) } : null;
    // Low-emission zones (v1.7): a diesel truck pays to load or unload in them.
    const lezCents = (await featureFor(tx, userId, 'low_emission_zones', now)) ? lezFeeCents([contract!.originCityId, contract!.destCityId, ...(contract!.stops ?? []).map((st) => st.cityId)], { electric: !!unit.electric, van: unit.kind === 'van' }) : 0;
    const extras = oversizeCents + cargoInsuranceCents + parkingCents + lezCents;
    const costs = rented ? { fuelCents: 0, tollCents: 0, maintenanceCents: 0, crossingCents: ticket, oversizeCents, cargoInsuranceCents, parkingCents, theftCents, lezCents, totalCents: ticket + extras, wear: 0 } : { ...running, crossingCents: ticket, oversizeCents, cargoInsuranceCents, parkingCents, theftCents, lezCents, fuelStation, totalCents: running.totalCents + ticket + extras };
    // Company members get a cheaper rental through the company's rental partner.
    const perks = rented ? await bonusesForUser(tx, userId) : null;
    // A test drive (v1.5) has no rental fee.
    const rentalFee = rented && bundle.vehicle.testDriveFrom ? 0 : rented ? rentalFeeCents(load.rewardCents, totalKm, (perks?.bonuses.rentalShareReduction ?? 0) + (vip ? VIP_PERKS.rentalShareReduction : 0)) : null;

    // The real weather on the roads now (v1.4), when there is a fresh reading.
    const real = await realConditionsFor(tx, userId, now);
    // Surprises on the way, decided now and revealed when the truck gets there.
    // Maintenance (v1.3): an overdue truck gets into trouble more often, a freshly serviced one less.
    const upkeep = !rented && (await featureFor(tx, userId, 'maintenance', now)) ? maintenanceState(bundle.vehicle.odometerKm, bundle.vehicle.serviceKm).factor : 1;
    const roadEvents = process.env.ROAD_EVENTS === 'off' ? [] : planRoadEvents(schedule, { totalKm: chargedEmptyKm + roadLoadedKm, borders: loadedRoute!.borders.length + (contract!.urgent ? 0 : (emptyRoute?.borders.length ?? 0)), rented, random: Math.random, chance: crew.eventChance * upkeep * (bundle.trailer?.upgrades.includes('led_markers') ? (TRAILER_UPGRADES.led_markers.incidents ?? 1) : 1), ghostChance: isHalloween(now) ? HALLOWEEN.ghostChance : 0, risks: violations, winter: isWinter(now) || real ? { condition: routeCondition(loadedRoute!.countries, now, real).condition, tyres: rented || hasWinterGrip(bundle.vehicle.upgrades) } : undefined });
    const [delivery] = await tx
      .insert(deliveries)
      .values({
        contractId: loadId,
        companyId: company.id,
        vehicleId,
        trailerId: bundle.trailer?.id ?? null,
        driverId: bundle.driver!.id,
        coDriverId: bundle.coDriver?.id ?? null,
        violations: violations.map((v) => v.violation),
        // A night shift tires the driver more.
        endDutyMin: night ? Math.round(trip.endDutyMin * NIGHT.fatigue) : trip.endDutyMin,
        nightShift: night,
        emptyRouteId: emptyRoute?.id ?? null,
        routeId: loadedRoute!.id,
        emptyKm: emptyRoute?.distanceKm ?? 0,
        loadedKm: loadedRoute!.distanceKm,
        schedule,
        estimatedCosts: costs,
        rentalFeeCents: rentalFee,
        scheduleVersion: SCHEDULE_VERSION,
        roadEvents,
        nextEventAt: roadEvents[0] ? new Date(roadEvents[0].at) : null,
        startedAt: now,
        etaAt: new Date(scheduleEnd(schedule)),
        deadlineAt: new Date(now.getTime() + (contract!.windowMinutes * 60_000) / timeScale()),
      })
      .returning();
    await tx.update(vehicles).set({ status: 'on_delivery' }).where(eq(vehicles.id, vehicleId));
    // A friend or company member left on the same lane a moment ago: drive together.
    if (!contract!.urgent) await formConvoy(tx, delivery!, userId, { originCityId: contract!.originCityId, destCityId: contract!.destCityId }, now);
    // A load handed over by a company: the agreed commission is paid when it arrives.
    await acceptJobOffer(tx, userId, contractId, delivery!.id, now);
    await logActivity(tx, userId, 'contract_accepted', { contractId: loadId, ...(partial ? { partOf: contractId } : {}), vehicleId, deliveryId: delivery!.id });
    await broadcast(tx, 'market');
    await broadcast(tx, 'world');
    return delivery!;
  });
}

type DeliveryRow = typeof deliveries.$inferSelect;

/**
 * Groupage drops of a delivery: when the truck finished unloading at each and
 * whether that was late. A drop's deadline is its window's share of the trip's.
 */
export function stopResults(stops: readonly ContractStop[], d: Pick<DeliveryRow, 'schedule' | 'startedAt' | 'deadlineAt'>, windowMinutes: number) {
  const segments = d.schedule as Segment[];
  const span = d.deadlineAt.getTime() - d.startedAt.getTime();
  const full = Math.max(1, windowMinutes);
  return stops.map((s, i) => {
    const at = segments.find((seg) => seg.stop === i + 1)?.end ?? null;
    const deadline = d.startedAt.getTime() + span * Math.min(1, s.windowMinutes / full);
    return { ...s, at, deadline, late: at != null && at > deadline };
  });
}

/** Settles one finished delivery exactly once. Returns false if it was not due or already settled. */
export async function settleDelivery(tx: Tx, deliveryId: string, now = new Date()): Promise<boolean> {
  const [d] = await tx
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'in_progress'), lte(deliveries.etaAt, now)))
    .for('update', { skipLocked: true });
  if (!d) return false;
  // Road events the worker has not applied yet happen first and may push the arrival later.
  if (d.nextEventAt && d.nextEventAt <= now && (await applyRoadEvents(tx, d, now)) > now.getTime()) return false;
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
  const crossingCents = (costs as { crossingCents?: number }).crossingCents ?? 0;
  if (crossingCents) postings.push({ category: 'crossings', amountCents: -crossingCents, description: 'Билет за ферибот / влак', idempotencyKey: key('crossing'), refType: 'delivery', refId: d.id });
  // The fuel station where the truck filled up earns its margin (paid by the game).
  const station = (costs as { fuelStation?: { orgId: string; cents: number } | null }).fuelStation;
  const cargoInsuranceCents = (costs as { cargoInsuranceCents?: number }).cargoInsuranceCents ?? 0;
  if (cargoInsuranceCents) postings.push({ category: 'insurance', amountCents: -cargoInsuranceCents, description: 'Застраховка на товара', idempotencyKey: key('cargo-insurance'), refType: 'delivery', refId: d.id });
  const lezCents = (costs as { lezCents?: number }).lezCents ?? 0;
  if (lezCents) postings.push({ category: 'tolls', amountCents: -lezCents, description: 'Такса за нискоемисионна зона', idempotencyKey: key('lez'), refType: 'delivery', refId: d.id });
  const parkingCents = (costs as { parkingCents?: number }).parkingCents ?? 0;
  if (parkingCents) postings.push({ category: 'road_events', amountCents: -parkingCents, description: 'Охраняем паркинг за почивките', idempotencyKey: key('parking'), refType: 'delivery', refId: d.id });
  // A free lay-by (v1.6): fuel stolen during a rest is known only on arrival.
  const theftCents = (costs as { theftCents?: number }).theftCents ?? 0;
  if (theftCents) postings.push({ category: 'road_events', amountCents: -theftCents, description: 'Откраднато гориво на паркинг без охрана', idempotencyKey: key('theft'), refType: 'delivery', refId: d.id });
  const oversizeCents = (costs as { oversizeCents?: number }).oversizeCents ?? 0;
  if (oversizeCents) postings.push({ category: 'oversize', amountCents: -oversizeCents, description: 'Разрешително и придружаваща кола', idempotencyKey: key('oversize'), refType: 'delivery', refId: d.id });
  // A night shift on time (v1.5).
  const nightBonus = d.nightShift && !result.late ? Math.round(result.rewardCents * NIGHT.bonusShare) : 0;
  if (nightBonus) postings.push({ category: 'night_bonus', amountCents: nightBonus, description: 'Бонус „Нощна смяна“', idempotencyKey: key('night'), refType: 'delivery', refId: d.id });
  if (result.bonusCents) postings.push({ category: 'bonus', amountCents: result.bonusCents, description: 'Бонус за ранна доставка', idempotencyKey: key('bonus'), refType: 'delivery', refId: d.id });
  // Reputation pays: +1 % of the reward per 10 points (up to +10 %), by the reputation before this delivery.
  const reputationBonus = Math.round(result.rewardCents * reputationBonusShare(company!.reputation));
  if (reputationBonus) postings.push({ category: 'reputation_bonus', amountCents: reputationBonus, description: `Бонус за репутация (${Math.floor(company!.reputation)})`, idempotencyKey: key('reputation'), refType: 'delivery', refId: d.id });
  if (d.rentalFeeCents) postings.push({ category: 'rental', amountCents: -d.rentalFeeCents, description: `Наем на камиона (${Math.round(d.emptyKm + d.loadedKm)} км)`, idempotencyKey: key('rental'), refType: 'delivery', refId: d.id });
  // Convoy: a friend or company member drove the same lane; on time, each gets a bonus.
  const convoyBonus = d.convoyWith && !result.late ? Math.round(result.rewardCents * CONVOY_RULES.bonusShare) : 0;
  if (convoyBonus) postings.push({ category: 'convoy_bonus', amountCents: convoyBonus, description: 'Бонус за конвой', idempotencyKey: key('convoy'), refType: 'delivery', refId: d.id });
  if (result.penaltyCents) postings.push({ category: 'penalty', amountCents: -result.penaltyCents, description: 'Неустойка за закъснение', idempotencyKey: key('penalty'), refType: 'delivery', refId: d.id });
  // Groupage: each drop on the way has its own window; a late one costs a penalty on its share.
  const drops = contract.stops?.length ? stopResults(contract.stops, d, contract.windowMinutes) : [];
  const stopPenalty = stopPenaltyCents(result.rewardCents, contract.weightTons, drops.filter((s) => s.late));
  // An insured load: most of the late penalties come back.
  const insurancePayout = cargoInsuranceCents ? Math.round((result.penaltyCents + stopPenalty) * CARGO_INSURANCE.covers) : 0;
  if (insurancePayout) postings.push({ category: 'insurance_payout', amountCents: insurancePayout, description: 'Обезщетение от застраховката на товара', idempotencyKey: key('cargo-insurance-payout'), refType: 'delivery', refId: d.id });
  if (stopPenalty) postings.push({ category: 'penalty', amountCents: -stopPenalty, description: `Закъснели спирки (${drops.filter((s) => s.late).length} от ${drops.length})`, idempotencyKey: key('stop-penalty'), refType: 'delivery', refId: d.id });
  // Company membership: bonus from the company's upgrades and a contribution to its treasury.
  const perks = await bonusesForUser(tx, company!.ownerId);
  const org = perks?.membership.company;
  const companyBonus = perks ? Math.round(result.rewardCents * (perks.bonuses.rewardMultiplier - 1)) : 0;
  const contribution = org ? Math.round(result.rewardCents * org.contributionRate) : 0;
  if (companyBonus) postings.push({ category: 'company_bonus', amountCents: companyBonus, description: `Бонус от „${org!.name}“`, idempotencyKey: key('company-bonus'), refType: 'delivery', refId: d.id });
  if (contribution) postings.push({ category: 'company_contribution', amountCents: -contribution, description: `Вноска към касата на „${org!.name}“`, idempotencyKey: key('contribution'), refType: 'delivery', refId: d.id });
  await post(tx, d.companyId, postings.filter((p) => p.amountCents !== 0));
  // The perfect trip (v1.5): on time, no breakdown or police, no fine, a full truck — the streak pays.
  const [trailerRow] = d.trailerId ? await tx.select({ modelId: trailers.modelId }).from(trailers).where(eq(trailers.id, d.trailerId)) : [];
  const payloadTons = combinationCapability({ unit: powerUnitModel(vehicle!.modelId), trailer: trailerRow ? trailerModel(trailerRow.modelId) : null }).payloadTons;
  const perfect = await recordPerfectTrip(tx, company!.ownerId, { late: result.late, violations: d.violations, events: d.roadEvents, tons: contract.weightTons, payloadTons, rewardCents: result.rewardCents }, completedAt);
  if (perfect.bonusCents) await post(tx, d.companyId, [{ category: 'perfect_bonus', amountCents: perfect.bonusCents, description: `Перфектна серия: ${perfect.streak} подред`, idempotencyKey: key('perfect'), refType: 'delivery', refId: d.id }]);
  // v1.5: a perfect convoy (both on time, together) and the first trip of a new company member.
  const convoyPerfect = await settlePerfectConvoy(tx, d, { userId: company!.ownerId, late: result.late, at: completedAt, rewardCents: result.rewardCents, originCityId: contract.originCityId, destCityId: contract.destCityId });
  const firstTrip = perks ? await firstTripBonus(tx, company!.ownerId, d, result.rewardCents, completedAt) : 0;
  const hallBonus = perks ? await allianceHallBonus(tx, company!.ownerId, perks.membership.company.id, d, result.rewardCents, completedAt) : 0;
  // v1.6: the equinox and the passes that open after the winter.
  // v1.6: a big convoy (3–5 trucks) on time.
  const specBonus = await specializationBonus(tx, company!.ownerId, org, d, contract.cargoType, result.rewardCents, completedAt);
  const bigConvoy = await bigConvoyBonus(tx, company!.ownerId, d, { late: result.late, rewardCents: result.rewardCents }, completedAt);
  const springBonus = (await equinoxBonus(tx, company!.ownerId, d, { late: result.late, rewardCents: result.rewardCents }, completedAt)) + (await recordPassOpening(tx, company!.ownerId, d, result.late, completedAt));
  const hireCommission = await payHireCommission(tx, d, result.rewardCents);
  // Personal account first, then treasuries (fixed lock order).
  if (station?.cents) await postTreasury(tx, station.orgId, [{ category: 'fuel_station', amountCents: station.cents, description: `Гориво на станцията: ${contract.goods}`, idempotencyKey: key('fuel-station'), refType: 'delivery', refId: d.id }]);
  if (contribution) {
    // Personal account first, then the treasury (fixed lock order).
    const [member] = await tx.select({ username: users.username }).from(users).where(eq(users.id, company!.ownerId));
    await postTreasury(tx, org!.id, [
      { category: 'member_contribution', amountCents: contribution, description: `${member!.username}: ${contract.goods} → ${dest!.nameBg}`, idempotencyKey: key('contribution-in'), actorUserId: company!.ownerId, refType: 'delivery', refId: d.id },
    ]);
  }

  const payout = -hireCommission + result.rewardCents + result.bonusCents + reputationBonus + convoyBonus + nightBonus + perfect.bonusCents + convoyPerfect + firstTrip + hallBonus + springBonus + bigConvoy + specBonus + insurancePayout - result.penaltyCents - stopPenalty - costs.totalCents - theftCents - (d.rentalFeeCents ?? 0) + companyBonus - contribution;
  const onTime = !result.late;
  // Lane records (v1.5): the fastest loaded run on the lane this month.
  await recordLaneRun(tx, company!.ownerId, d, { originCityId: contract.originCityId, destCityId: contract.destCityId }, result.late, completedAt);
  // The city album (v1.5): a card for the destination.
  await recordCityVisit(tx, company!.ownerId, contract.destCityId, completedAt);
  // Евротур (v1.6): all nine countries in one month.
  await checkEurotour(tx, company!.ownerId, dest!.countryCode, completedAt);
  // The company academy (v1.5): an on-time trip of a student is a course.
  await recordAcademyCourse(tx, company!.ownerId, { onTime, loadedKm: d.loadedKm }, completedAt);
  const baseXp = deliveryXp(d.loadedKm, contract.weightTons, onTime, upgradeFactor(vehicle!.upgrades, 'xp'));
  // XP bonuses: company training, VIP, the shop's double-XP booster and a mentor.
  const [owner] = await tx.select({ vipUntil: users.vipUntil, xpBoostUntil: users.xpBoostUntil }).from(users).where(eq(users.id, company!.ownerId));
  const vipXp = isVip(owner?.vipUntil, now) ? VIP_PERKS.xpMultiplier : 1;
  const boostXp = owner?.xpBoostUntil && owner.xpBoostUntil > now ? 2 : 1;
  // A newcomer with a mentor learns faster.
  const mentorXp = await mentorXpFactor(tx, company!.ownerId, now);
  // "Строителен бум": hauling building materials teaches more.
  const boomXp = contract.constructionId && (await boomFor(tx, company!.ownerId, completedAt)) ? BOOM.xpFactor : 1;
  const xp = Math.round(baseXp * (perks?.bonuses.xpMultiplier ?? 1) * vipXp * boostXp * mentorXp * boomXp);
  // The player's own driving gives all of the XP; a hired driver's trip only a share (the driver learns from all of it).
  const ownerDrove = (await tx.select({ id: drivers.id }).from(drivers).where(and(inArray(drivers.id, [d.driverId, d.coDriverId].filter((x): x is string => !!x)), eq(drivers.isOwner, true)))).length > 0;
  const playerXp = ownerDrove ? xp : Math.round(xp * FLEET_XP_SHARE);
  if (perks) {
    // The company learns from every member trip, at its own (slower) pace; hired drivers' trips count less.
    // A trip with a company trailer (v1.4): more company XP and a bonus into the treasury.
    const orgTrailer = d.trailerId ? (await tx.select({ orgTrailerId: trailers.orgTrailerId }).from(trailers).where(eq(trailers.id, d.trailerId)))[0]?.orgTrailerId : null;
    const companyXp = Math.round(baseXp * COMPANY_XP_SHARE * (ownerDrove ? 1 : FLEET_XP_SHARE) * (orgTrailer ? COMPANY_TRAILERS.companyXp : 1));
    if (orgTrailer) {
      const [member] = await tx.select({ username: users.username }).from(users).where(eq(users.id, company!.ownerId));
      await companyTrailerBonus(tx, perks.membership.company.id, d.id, result.rewardCents, member!.username);
    }
    await tx
      .update(companyMembers)
      .set({ deliveries: sql`${companyMembers.deliveries} + 1`, contributedCents: sql`${companyMembers.contributedCents} + ${contribution}`, xpContributed: sql`${companyMembers.xpContributed} + ${companyXp}` })
      .where(eq(companyMembers.userId, company!.ownerId));
    await addCompanyXp(tx, perks.membership.company.id, companyXp);
    // v1.5: the alliance's week counts the tonnes; a client's load pays the hauler company its share.
    await recordAllianceDelivery(tx, perks.membership.company.id, contract.weightTons, completedAt);
    await recordHallDelivery(tx, company!.ownerId, perks.membership.company.id, { cargoType: contract.cargoType, destCityId: contract.destCityId, tons: contract.weightTons }, completedAt);
    const client = contract.factoryOrgId ?? contract.branchOrgId;
    if (client && client !== perks.membership.company.id) await payCompanyContract(tx, client, perks.membership.company.id, d.id, result.rewardCents, contract.weightTons, completedAt);
  }

  await tx
    .update(deliveries)
    .set({ status: 'completed', completedAt, late: result.late, payoutCents: payout, xpAwarded: playerXp })
    .where(eq(deliveries.id, d.id));
  await tx
    .update(vehicles)
    .set({ status: 'idle', cityId: contract.destCityId, condition: sql`greatest(0, ${vehicles.condition} - ${costs.wear})`, odometerKm: sql`${vehicles.odometerKm} + ${d.emptyKm + d.loadedKm}` })
    .where(eq(vehicles.id, d.vehicleId));
  // A legendary truck (v1.6): 100 000 / 250 000 / 500 000 km.
  await checkLegend(tx, company!.ownerId, vehicle!, vehicle!.odometerKm, vehicle!.odometerKm + d.emptyKm + d.loadedKm, completedAt);
  if (d.trailerId) await tx.update(trailers).set({ cityId: contract.destCityId, condition: sql`greatest(0, ${trailers.condition} - ${costs.wear * 0.6})` }).where(eq(trailers.id, d.trailerId));
  // Drivers grow with experience: one skill level per 8 000 XP, never downwards.
  // They also carry the driving hours of this trip until they have rested (a team shares them).
  const crewIds = [d.driverId, d.coDriverId].filter((x): x is string => !!x);
  const dutyEach = d.endDutyMin / crewIds.length;
  // The company's driving range (v1.5): the drivers learn faster.
  const driverXp = Math.round(xp * (perks?.bonuses.driverXpMultiplier ?? 1));
  await tx
    .update(drivers)
    .set({
      xp: sql`${drivers.xp} + ${driverXp}`,
      skill: sql`greatest(${drivers.skill}, least(5, 1 + floor((${drivers.xp} + ${driverXp}) / 8000.0)::int))`,
      dutyMin: dutyEach,
      // The company's rest stop shortens the rest after a trip that ends in the base city.
      restedAt: new Date(completedAt.getTime() + (CREW_RULES.restGameMin * 60_000 * (1 - (org && contract.destCityId === org.hqCityId ? (perks?.bonuses.restCut ?? 0) : 0))) / timeScale()),
    })
    .where(inArray(drivers.id, crewIds));
  await tx
    .update(companies)
    .set({
      deliveries: sql`${companies.deliveries} + 1`,
      onTimeDeliveries: sql`${companies.onTimeDeliveries} + ${onTime ? 1 : 0}`,
      totalKm: sql`${companies.totalKm} + ${d.emptyKm + d.loadedKm}`,
      reputation: reputationAfter(company!.reputation, onTime),
    })
    .where(eq(companies.id, d.companyId));

  // Own goods: sold at the destination market (at today's price, before this lot lowers demand) or stored there.
  // On the freight exchange (v1.4) the goods are someone else's: their owner gets the sale.
  const goodsOwner = contract.exchange && contract.tradeCompanyId ? (await tx.select({ id: companies.id, ownerId: companies.ownerId }).from(companies).where(eq(companies.id, contract.tradeCompanyId)))[0] ?? null : null;
  if (contract.trade) await settleTradeLot(tx, contract, goodsOwner?.id ?? d.companyId, goodsOwner?.ownerId ?? company!.ownerId, completedAt);
  if (contract.exchange) await settleExchange(tx, contract, company!.ownerId, result.penaltyCents);
  // Shared economy: deliveries saturate the destination market for everyone (goods put into a warehouse do not).
  if (contract.trade?.mode !== 'store') await tx
    .update(cityMarkets)
    .set({ demand: sql`greatest(${ECONOMY.demandFloor}, ${cityMarkets.demand} - ${contract.weightTons * ECONOMY.demandDropPerTon})`, updatedAt: now })
    .where(and(eq(cityMarkets.cityId, contract.destCityId), eq(cityMarkets.cargoType, contract.cargoType)));

  await awardXp(tx, company!.ownerId, playerXp, ownerDrove ? 'delivery' : 'fleet');
  // Missions: what this delivery contributes (route countries plus both ends).
  const [origin] = await tx.select({ country: cities.countryCode }).from(cities).where(eq(cities.id, contract.originCityId));
  const [route] = await tx.select({ countries: routes.countries }).from(routes).where(eq(routes.id, d.routeId));
  const facts = {
    loadedKm: d.loadedKm,
    tons: contract.weightTons,
    onTime,
    rewardCents: result.rewardCents,
    cargoType: contract.cargoType,
    countries: contractCountries(origin!.country, dest!.countryCode, route?.countries),
    urgent: contract.urgent,
    inCompany: !!perks,
    // Holiday events count the holiday's own loads (winter goods are seasonal, not a holiday).
    holiday: !!contract.holiday && contract.holiday !== 'winter',
  };
  await recordMissionProgress(tx, company!.ownerId, facts, now);
  // Global events count by arrival time; company missions by the member's company.
  await recordEventProgress(tx, company!.ownerId, org?.id ?? null, facts, completedAt);
  if (org) await recordCompanyMissionProgress(tx, org.id, company!.ownerId, facts, now);
  if (org) await recordProjectDelivery(tx, org.id, company!.ownerId, { cargoType: contract.cargoType, destCityId: contract.destCityId, tons: contract.weightTons }, completedAt);
  if (org) await recordBattleDelivery(tx, org.id, contract.weightTons, completedAt);
  // Building materials for the company's plot.
  await recordMaterialDelivery(tx, contract, company!.ownerId, completedAt);
  await recordWeeklyGoal(tx, company!.ownerId, { loadedKm: d.loadedKm, tons: contract.weightTons }, completedAt);
  // A long trip the player drove themselves goes to the friends feed.
  if (ownerDrove && d.loadedKm >= FEED_LONG_TRIP_KM) await addFeed(tx, { userId: company!.ownerId, kind: 'trip', text: `достави ${contract.goods} до ${dest!.nameBg} (${Math.round(d.loadedKm).toLocaleString('bg-BG')} км)` }, completedAt);
  const points = seasonPoints(d.loadedKm, contract.weightTons, onTime);
  await addSeasonScore(tx, d.companyId, points, result.rewardCents, now);
  if (org) await addOrganizationSeasonScore(tx, org.id, points, now);
  await addLeaguePoints(tx, company!.ownerId, points, now);
  await addPassPoints(tx, company!.ownerId, points, now);
  await rewardReferral(tx, company!.ownerId, now);
  // Return loads come with v1.2 (staff see them before the release).
  // The hauler of someone else's goods gets the usual "Доставено" message.
  const ownGoods = !!contract.trade && !contract.exchange;
  const backhaul = !ownGoods && (await featureFor(tx, company!.ownerId, 'backhaul', completedAt));
  // Own goods get their own message (sale or warehouse) from settleTradeLot.
  if (!ownGoods) await notify(
    tx,
    company!.ownerId,
    onTime ? 'success' : 'warning',
    onTime ? `Доставено: ${contract.goods} в ${dest!.nameBg}` : `Закъсняла доставка в ${dest!.nameBg}`,
    `Нетен резултат ${(payout / 100).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} лв., +${playerXp} опит.${drops.length ? ` Спирки навреме: ${drops.filter((x) => !x.late).length} от ${drops.length}.` : ''}${backhaul ? ` Виж товарите обратно от ${dest!.nameBg}.` : ''}`,
    // Straight to the return loads from where the truck now stands.
    backhaul ? `/game/contracts?from=${contract.destCityId}&truck=${vehicle!.id}` : '/game/finance',
  );
  // Halloween quests: holiday loads, night arrivals.
  if (isHalloween(completedAt)) await recordHalloweenDelivery(tx, company!.ownerId, { holiday: contract.holiday === 'halloween', loadedKm: d.loadedKm, arrivedAt: completedAt });
  // Christmas quests: Christmas loads, arrivals on Christmas Eve and Day.
  // Великден (v1.5).
  if (isEaster(completedAt)) await recordEasterDelivery(tx, company!.ownerId, { holiday: contract.holiday === 'easter', loadedKm: d.loadedKm, arrivedAt: completedAt });
  // Баба Марта (v1.5): spring loads.
  if (isMarta(completedAt)) await recordMartaDelivery(tx, company!.ownerId, { holiday: contract.holiday === 'marta', loadedKm: d.loadedKm });
  if (isChristmas(completedAt)) await recordChristmasDelivery(tx, company!.ownerId, { holiday: contract.holiday === 'christmas', loadedKm: d.loadedKm, arrivedAt: completedAt });
  // A special load won on auction.
  if (contract.auctionId) await deliverAuctionLoad(tx, contract.auctionId, company!.ownerId);
  // A load of a long-term client contract.
  if (contract.clientContractId) await recordClientLoad(tx, contract.clientContractId, result.late, company!.ownerId, completedAt);
  // A load of a company tender.
  if (contract.tenderId) await recordTenderLoad(tx, contract.tenderId, company!.ownerId, completedAt);
  // The load of the day: ТрансКоин when on time.
  if (contract.featured && onTime) await deliverDailyLoad(tx, contract, company!.ownerId);
  // A part of a load shared with the company: the bonus once every part has arrived on time.
  if (contract.sharedLoadId) await settleSharedPart(tx, contract.sharedLoadId, now);
  // A delivery to a city where the member's company has a branch.
  await branchBonus(tx, d, company!.ownerId, contract.destCityId, result.rewardCents, completedAt);
  // Raw materials for the company's factory, or its product to a buyer.
  if (contract.factoryOrgId) await recordFactoryDelivery(tx, contract);
  // A container of a ship call ("Кораб пристига").
  if (contract.portCallId) await recordShipContainer(tx, contract.portCallId);
  // A weekly rally run: its time and fuel count.
  if (contract.rallyId) await recordRallyRun(tx, contract, d, completedAt);
  // Duels count the tonnes by arrival time.
  await recordDuelDelivery(tx, company!.ownerId, contract.weightTons, completedAt);
  // Starter rental: returned now if the player bought their own truck, or offered for buy-out.
  if (vehicle!.ownership === 'rented') await afterRentedTrip(tx, vehicle!.id, company!.ownerId, now);
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
  // Urgent shipments keep the deadline their administrator set.
  const open = await db.select({ id: contracts.id, distanceKm: contracts.distanceKm, windowMinutes: contracts.windowMinutes }).from(contracts).where(and(eq(contracts.status, 'open'), eq(contracts.urgent, false)));
  for (const c of open) {
    const window = contractWindowMinutes(c.distanceKm);
    if (c.windowMinutes > window) await db.update(contracts).set({ windowMinutes: window }).where(eq(contracts.id, c.id));
  }
  return legacy.length;
}
