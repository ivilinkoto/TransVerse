import Link from 'next/link';
import { Hint } from '@/components/game/Hint';
import { CONVOY_RULES } from '@/lib/game/convoy';
import { ContractBoard, type BoardContract } from '@/components/game/ContractBoard';
import { PageHeader } from '@/components/ui';
import { fuelPriceCents, legFuelPriceCents } from '@/lib/game/fuel';
import { CONDITION_LABELS, routeCondition } from '@/lib/game/winter';
import { convoyCandidates } from '@/server/game/convoy';
import { canOfferJobs, offersFor } from '@/server/game/hire';
import { activeProject } from '@/server/game/projects';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { combinationCapability } from '@/lib/game/catalog';
import { rentalFeeCents, tripCosts } from '@/lib/game/economy';
import { estimateGameMinutes } from '@/lib/game/schedule';
import { crewEffects, restLeftMin } from '@/lib/game/crew';
import { overloadPercent } from '@/lib/game/fines';
import { canSplit, partRewardCents, partTons } from '@/lib/game/partial';
import { SHARED_LOAD } from '@/lib/game/together';
import { CROSSING_LINES, crossingLine, crossingNote, railOptions } from '@/lib/game/crossings';
import { activeShipCall } from '@/server/game/ports';
import { realConditionsFor } from '@/server/game/weather';
import { haversineKm } from '@/lib/geo/geometry';
import { gameContext } from '@/server/game/context';
import { ensureLocalJobsForFleet, openContracts } from '@/server/game/contracts';
import { BODY_LABELS, compatibilityError, URGENT_RELOCATION_MS } from '@/server/game/deliveries';
import { haggleable, hagglesOf } from '@/server/game/deals';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { cities as citiesTable, contracts as contractsTable, deliveries } from '@/server/db/schema';
import { fleetView } from '@/server/game/queries';
import { LICENCES } from '@/lib/game/licences';
import { isVip, VIP_PERKS } from '@/lib/game/vip';
import { heldLicences, missingFor } from '@/server/game/licences';

import { FleetCondition } from '@/components/game/FleetCondition';
import { DispatchPanel } from '@/components/game/DispatchPanel';
import { favoriteLanesOf } from '@/server/game/favorites';
import { membershipOf } from '@/server/game/membership';
import { isNightShift, NIGHT, oversizeCostCents } from '@/lib/game/roads';
import { activeRoadWorks } from '@/server/game/roads';
import { TRAFFIC } from '@/lib/game/traffic';
import { specializationCovers } from '@/lib/game/specialization';
import { LOW_EMISSION_ZONES } from '@/lib/game/europe-roads';

export const metadata = { title: 'Поръчки' };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ fav?: string; hired?: string; lane?: string; from?: string; truck?: string; load?: string }> }) {
  const params = await searchParams;
  const onlyFavorites = params.fav === '1';
  const { db, user, company, hq, now, features } = await gameContext();
  const favorites = await favoriteLanesOf(db, user.id);
  // Loads companies handed to this player, and whether the player may hand loads out.
  const [hiredOffers, canAssign] = features.hire ? await Promise.all([offersFor(db, user.id, now), canOfferJobs(db, user.id)]) : [[], false] as const;
  const hiredBy = new Map(hiredOffers.map((o) => [o.contractId, { offerId: o.id, company: o.tag ? `[${o.tag}] ${o.company}` : o.company, share: o.share, until: o.expiresAt.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Sofia' }) }]));
  // Lanes a friend or company member just left on (first one per lane).
  const convoys = new Map<string, string>();
  if (features.convoy) for (const c of await convoyCandidates(db, user.id, now)) if (!convoys.has(`${c.originCityId}:${c.destCityId}`)) convoys.set(`${c.originCityId}:${c.destCityId}`, c.username);
  // Every free vehicle always has at least one job it can take in its own city.
  await ensureLocalJobsForFleet(db, now, company.id).catch((e) => console.warn('[contracts] local jobs', e));
  const [fleet, licences, taken] = await Promise.all([
    fleetView(db, company.id),
    heldLicences(db, user.id),
    // Urgent shipments stay open after others take them; remember which ones this player already has.
    db.select({ contractId: deliveries.contractId }).from(deliveries).innerJoin(contractsTable, eq(contractsTable.id, deliveries.contractId)).where(and(eq(deliveries.companyId, company.id), eq(contractsTable.urgent, true))),
  ]);
  const takenIds = new Set(taken.map((t) => t.contractId));
  const real = await realConditionsFor(db, user.id, now);
  // v1.4: rail terminals (for "С влак") and the ship in port.
  const terminalIds = [...new Set(CROSSING_LINES.filter((l) => l.kind === 'rail' || (l.optional && features.sea_lines)).flatMap((l) => [l.a, l.b]))];
  const terminals = features.rail || features.sea_lines ? new Map((await db.select({ id: citiesTable.id, lat: citiesTable.lat, lon: citiesTable.lon }).from(citiesTable).where(inArray(citiesTable.id, terminalIds))).map((t) => [t.id, t])) : new Map();
  const ship = features.ship_calls ? await activeShipCall(db) : null;
  const works = features.road_works ? await activeRoadWorks(db, now) : [];
  const vip = isVip(user.vipUntil, now);
  const hhmm = (d: Date) => d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Sofia' });
  const localCities = [...new Set(fleet.vehicles.filter((v) => !v.delivery).map((v) => v.cityId))];
  const membership = await membershipOf(db, user.id);
  const memberOfCompanyId = membership?.company.id ?? null;
  const project = memberOfCompanyId && features.projects ? await activeProject(db, memberOfCompanyId) : null;
  const [general, ...locals] = await Promise.all([openContracts(db, { limit: 250, memberOfCompanyId, withStops: features.multistop, withSea: features.ferries, withExchange: features.freight_exchange, withOversize: features.oversize, withContracts: features.company_contracts, viewerUserId: user.id, withEurope: features.europe }), ...localCities.map((cityId) => openContracts(db, { originCityId: cityId, limit: 50, memberOfCompanyId, withStops: features.multistop, withSea: features.ferries, withExchange: features.freight_exchange, withOversize: features.oversize, withContracts: features.company_contracts, viewerUserId: user.id, withEurope: features.europe }))]);
  // "Drive in convoy" from the map: only the loads on that lane (from its origin city, all of them).
  const laneMatch = features.convoy ? /^(\d+)-(\d+)$/.exec(params.lane ?? '') : null;
  const lane = laneMatch ? { from: Number(laneMatch[1]), to: Number(laneMatch[2]) } : null;
  const laneLoads = lane ? await openContracts(db, { originCityId: lane.from, limit: 100, memberOfCompanyId, withStops: features.multistop, withSea: features.ferries, withExchange: features.freight_exchange, withOversize: features.oversize, withContracts: features.company_contracts, viewerUserId: user.id, withEurope: features.europe }) : [];
  // "Return load" after a delivery: the loads from where the truck now stands, that truck first.
  const fromCity = features.backhaul && /^\d+$/.test(params.from ?? '') ? Number(params.from) : null;
  const backTruck = fromCity ? fleet.vehicles.find((v) => v.id === params.truck && !v.delivery) ?? fleet.vehicles.find((v) => !v.delivery && v.cityId === fromCity) ?? null : null;
  const backLoads = fromCity ? await openContracts(db, { originCityId: fromCity, limit: 100, memberOfCompanyId, withStops: features.multistop, withSea: features.ferries, withExchange: features.freight_exchange, withOversize: features.oversize, withContracts: features.company_contracts, viewerUserId: user.id, withEurope: features.europe }) : [];
  // A load opened by a link (the plot's material loads, Discord): its origin's loads too, so it is on the board even far from the trucks.
  const focusId = /^[0-9a-f-]{36}$/.test(params.load ?? '') && ![...general, ...locals.flat()].some((c) => c.id === params.load) ? params.load! : null;
  const [focusRow] = focusId ? await db.select({ originCityId: contractsTable.originCityId }).from(contractsTable).where(eq(contractsTable.id, focusId)) : [];
  const focusLoads = focusRow ? (await openContracts(db, { originCityId: focusRow.originCityId, limit: 250, memberOfCompanyId, withStops: features.multistop, withSea: features.ferries, withExchange: features.freight_exchange, withOversize: features.oversize, withContracts: features.company_contracts, viewerUserId: user.id, withEurope: features.europe })).filter((c) => c.id === focusId) : [];
  const seen = new Set<string>();
  const all = [...focusLoads, ...laneLoads, ...backLoads, ...locals.flat(), ...general].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  // v1.8: a refused haggle took the load away from this player.
  const haggles = features.haggling ? await hagglesOf(db, user.id, all.map((c) => c.id), now) : new Map();
  const contracts = all.filter((c) => haggles.get(c.id)?.accepted !== false);

  // Traffic from the players (v1.6): trucks on each lane right now.
  const laneTraffic = new Map<string, number>();
  if (features.road_traffic) {
    const rows = await db.select({ o: contractsTable.originCityId, d: contractsTable.destCityId, n: sql<number>`count(*)::int` }).from(deliveries).innerJoin(contractsTable, eq(contractsTable.id, deliveries.contractId)).where(eq(deliveries.status, 'in_progress')).groupBy(contractsTable.originCityId, contractsTable.destCityId);
    for (const r of rows) laneTraffic.set(`${r.o}:${r.d}`, r.n);
  }
  const board: BoardContract[] = contracts.map((c) => {
    const cargo = CARGO[c.cargoType as CargoType];
    // A ferry on the way (islands): no fuel on board, a ticket instead.
    const sea = c.route.crossing ? crossingLine(c.route.crossing.lineId) : null;
    const seaKm = c.route.crossing ? c.route.crossing.toKm - c.route.crossing.fromKm : 0;
    const options = (backTruck ? [backTruck, ...fleet.vehicles.filter((v) => v.id !== backTruck.id)] : fleet.vehicles).map((v) => {
      const bundle = { modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: !!v.driver, status: v.status, trailerCondition: v.trailer?.condition ?? null };
      const strict = compatibilityError(bundle, c, user.level);
      // Up to 10 % over the payload is possible as a risk the player chooses.
      const overloadable = !!strict && compatibilityError(bundle, c, user.level, true) === null;
      const cap = combinationCapability({ unit: v.model, trailer: v.trailer?.model ?? null });
      // A load bigger than the truck: only the part it carries, for the share of the pay (v1.3).
      const partT = strict && features.partial_loads && canSplit(c) ? partTons(c.weightTons, cap.payloadTons) : null;
      const part = partT && compatibilityError(bundle, { ...c, weightTons: partT }, user.level) === null ? { tons: partT, rewardCents: partRewardCents(c, partT) } : null;
      const error = v.driver?.vacationUntil && v.driver.vacationUntil > now ? 'Шофьорът е в почивен ден' : overloadable || part ? null : strict;
      // Planning estimates: empty leg by straight-line × 1.25, loaded leg from the real route.
      const emptyKm = v.cityId === c.originCityId ? 0 : haversineKm([v.city.lat, v.city.lon], [c.origin.lat, c.origin.lon]) * 1.25;
      // The urgent one-minute relocation is free; only the cargo leg costs.
      const chargedEmptyKm = c.urgent ? 0 : emptyKm;
      const crew = v.driver ? crewEffects(v.driver, v.coDriver, now) : undefined;
      const restMin = v.driver ? Math.max(restLeftMin(v.driver, now), v.coDriver ? restLeftMin(v.coDriver, now) : 0) : 0;
      const costs = tripCosts({ unit: v.model, trailer: v.trailer?.model ?? null, upgrades: [...v.upgrades, ...(v.trailer?.upgrades ?? [])], condition: v.condition, driverSkill: Math.max(v.driver?.skill ?? 1, v.coDriver?.skill ?? 0), crewFuel: crew?.fuel, crewWear: crew?.wear, emptyKm: chargedEmptyKm, loadedKm: c.distanceKm - seaKm, tons: part ? part.tons : c.weightTons, payloadTons: cap.payloadTons || 1, tolledRoute: { empty: !c.urgent, loaded: c.route.hasToll }, fuelPrice: { empty: fuelPriceCents(v.city.countryCode, now), loaded: legFuelPriceCents(c.origin.countryCode, c.distanceKm, c.route.borders, now) } });
      // Urgent: one minute to the pickup city, then the cargo leg at the shipment's speed.
      // The crew changes the trip time: a tired driver rests early, a team drives on.
      const tripMinutes = (cr: typeof crew) => (c.urgent ? (emptyKm > 0 ? URGENT_RELOCATION_MS / 60_000 : 0) + estimateGameMinutes(0, c.distanceKm, cr) / Math.max(1, c.speedFactor) : estimateGameMinutes(emptyKm, c.distanceKm, cr));
      const minutes = tripMinutes(crew);
      // Without the due rest (a risk the player may take): the trip as with a rested crew.
      const rushMinutes = crew && crew.startDutyMin > 0 ? tripMinutes({ ...crew, startDutyMin: 0 }) : null;
      const rented = v.ownership === 'rented';
      const pay = part ? part.rewardCents : c.rewardCents;
      const cost = (rented ? rentalFeeCents(pay, chargedEmptyKm + c.distanceKm) : costs.totalCents) + (sea?.ticketCents ?? 0) + (c.oversize ? oversizeCostCents(c.distanceKm - seaKm) : 0);
      return { vehicleId: v.id, label: `${v.plate} · ${v.model.name}${v.trailer ? ` + ${v.trailer.model.name}` : ''}${rented ? ' (нает)' : ''}${v.coDriver ? ' · екипаж' : ''} · ${v.city.nameBg} · ${Math.round(v.condition)}%${restMin ? ` · почива още ${restMin} мин` : ''}`, error, emptyKm: Math.round(emptyKm), costCents: cost, rented, profitCents: pay - cost, minutes, rushMinutes, overloadPercent: overloadable ? Math.ceil(overloadPercent(c.weightTons, cap.payloadTons)) : 0, part };
    });
    return {
      id: c.id,
      shipper: c.shipper,
      goods: features.sealed_cargo && c.sealed ? 'Запечатан товар' : c.goods,
      sealed: features.sealed_cargo && c.sealed,
      haggle: features.haggling && haggleable(c) && !c.reservedByCompanyId ? (haggles.get(c.id) ?? 'open') : null,
      cargoType: c.cargoType as CargoType,
      cargoLabel: cargo.label,
      needs: { bodies: cargo.bodies.map((b) => BODY_LABELS[b] ?? b), level: Math.max(c.minLevel, cargo.minLevel) },
      tons: c.weightTons,
      origin: { id: c.origin.id, name: c.origin.nameBg, country: c.origin.countryCode },
      destination: { id: c.destination.id, name: c.destination.nameBg, country: c.destination.countryCode },
      distanceKm: c.distanceKm,
      provider: c.route.provider,
      hasToll: c.route.hasToll,
      borders: c.route.borders.length,
      countries: c.route.countries,
      rewardCents: c.rewardCents,
      windowMinutes: c.windowMinutes,
      expiresAt: c.expiresAt.toISOString(),
      expiresInMin: Math.round((c.expiresAt.getTime() - now.getTime()) / 60_000),
      minLevel: Math.max(c.minLevel, cargo.minLevel),
      minReputation: c.minReputation,
      reputationLocked: company.reputation < c.minReputation,
      locked: user.level < Math.max(c.minLevel, cargo.minLevel),
      local: localCities.includes(c.originCityId),
      urgent: c.urgent,
      holiday: c.holiday,
      hiredBy: hiredBy.get(c.id) ?? null,
      project: project && project.cargoType === c.cargoType && project.destCityId === c.destCityId ? project.title : null,
      convoy: c.urgent ? null : (convoys.get(`${c.originCityId}:${c.destCityId}`) ?? null),
      specialization: features.specializations && specializationCovers(membership?.company.specialization, c.cargoType),
      transEurope: features.trans_europe && c.transEurope,
      lez: features.low_emission_zones ? [c.originCityId, c.destCityId].map((id) => LOW_EMISSION_ZONES[id]).filter((x): x is string => !!x) : [],
      traffic: (laneTraffic.get(`${c.originCityId}:${c.destCityId}`) ?? 0) >= TRAFFIC.from - 1 ? laneTraffic.get(`${c.originCityId}:${c.destCityId}`)! : 0,
      weather: (() => {
        const w = routeCondition(c.route.countries, now, real);
        return w.condition === 'clear' ? null : { condition: w.condition, label: CONDITION_LABELS[w.condition], country: w.country! };
      })(),
      favorite: favorites.some((f) => f.originCityId === c.originCityId && f.destCityId === c.destCityId),
      toHome: features.backhaul && c.destCityId === hq.id,
      construction: !!c.constructionId,
      lastLoad: c.lastLoad,
      stops: c.stopCities.map((st) => ({ name: st.name, country: st.country, tons: st.tons, windowMinutes: st.windowMinutes })),
      tender: !!c.tenderId,
      featured: !!c.featured,
      exchange: c.exchange ? c.shipper : null,
      rally: !!c.rallyId,
      urgentRaises: c.urgent ? c.urgentRaises : 0,
      oversizeCents: c.oversize ? oversizeCostCents(c.distanceKm) : null,
      roadWorks: (() => {
        const w = works.find((x) => c.route.countries.includes(x.countryCode));
        return w ? `Ремонт: ${w.road} · +${Math.round(w.delay * 100)}% време` : null;
      })(),
      ferry: sea ? { note: crossingNote(sea, c.route.profile.endsWith(':r')), ticketCents: sea.ticketCents } : null,
      port: c.port ? (c.portCallId && ship?.id === c.portCallId ? `КОРАБ ${ship.ship}` : 'ОТ ПРИСТАНИЩЕТО') : null,
      rail: (features.rail || features.sea_lines) && !c.urgent && !c.stops?.length && !sea
        ? railOptions(c.origin, c.destination, terminals, c.distanceKm, features.sea_lines).filter((o) => o.line.kind === 'ferry' || features.rail).slice(0, 2).map((o) => ({ id: `${o.line.id}:${o.reversed ? 'r' : 'f'}`, note: crossingNote(o.line, o.reversed), ticketCents: o.line.ticketCents, km: o.line.km, kind: o.line.kind, hours: o.line.hours }))
        : [],
      shared: !!c.sharedLoadId,
      // A member may share a big ordinary load with the company (members take parts of it).
      canShare: features.shared_loads && !!memberOfCompanyId && !c.sharedLoadId && canSplit(c) && c.weightTons >= SHARED_LOAD.minTons && !(c.reservedUntil && c.reservedUntil > now && c.reservedByCompanyId !== company.id),
      alreadyTaken: takenIds.has(c.id),
      reservedByMe: !!c.reservedUntil && c.reservedUntil > now && c.reservedByCompanyId === company.id,
      reservedByOther: !!c.reservedUntil && c.reservedUntil > now && c.reservedByCompanyId !== company.id,
      reservedUntil: c.reservedUntil && c.reservedUntil > now ? hhmm(c.reservedUntil) : null,
      // Urgent shipments open for non-VIP players a few minutes later.
      opensAt: c.urgent && !vip && now.getTime() < c.createdAt.getTime() + VIP_PERKS.urgentEarlyMs ? hhmm(new Date(c.createdAt.getTime() + VIP_PERKS.urgentEarlyMs)) : null,
      speedFactor: c.speedFactor,
      missingLicences: missingFor({ cargoType: c.cargoType, originCountry: c.origin.countryCode, destCountry: c.destination.countryCode, routeCountries: c.route.countries }, licences).map((id) => LICENCES[id].short),
      options,
    };
  });

  const laneBoard = lane ? board.filter((c) => c.origin.id === lane.from && c.destination.id === lane.to) : [];
  // Return loads: takeable with that truck first, then the best paid.
  const usableBy = (c: BoardContract) => (backTruck ? c.options.some((o) => o.vehicleId === backTruck.id && !o.error) : true);
  const backBoard = fromCity ? board.filter((c) => c.origin.id === fromCity).sort((a, b) => Number(usableBy(b)) - Number(usableBy(a)) || Number(b.toHome) - Number(a.toHome) || b.rewardCents - a.rewardCents) : [];
  const fromName = fromCity ? (backBoard[0]?.origin.name ?? fleet.vehicles.find((v) => v.cityId === fromCity)?.city.nameBg ?? null) : null;

  return (
    <div>
      <PageHeader
        title="Поръчки"
        subtitle="Избери товар, камион и тръгвай. Поръчките са общи за всички играчи."
        help="Горивото се плаща по цените на държавите по маршрута (виж Финанси → Дизел днес). По пътя може да се случи задръстване, ремонт, повреда или опашка на границата — това забавя курса, а повредата струва пари за пътна помощ (при наетия камион плаща наемодателят). Общ пазар за всички играчи: поръчка, поета от друга компания, изчезва от борсата. Разстоянията са по реалната пътна мрежа (Valhalla / OpenStreetMap), освен ако не е отбелязано „приблизително“."
      />
      {features.night_shift && isNightShift(now) && (
        <div className="mb-4 rounded-2xl border border-indigo-400/40 bg-indigo-500/10 px-4 py-3 text-sm">
          🌙 <b>Нощна смяна</b> — курсовете, тръгнали сега (22:00–05:00), са с {Math.round((NIGHT.faster - 1) * 100)}% по-бързи по празните пътища и носят +{Math.round(NIGHT.bonusShare * 100)}% бонус, ако стигнат навреме. Шофьорът се уморява повече.
        </div>
      )}
      {works.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-sig/40 bg-amber-sig/10 px-4 py-3 text-sm">
          🚧 <b>Ремонти по пътищата</b> (игрови данни): {works.map((w) => `${w.road} (+${Math.round(w.delay * 100)}% време)`).join(' · ')}. Курсовете през тези държави са по-бавни.
        </div>
      )}
      {ship && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm">
          <span>🚢 <b>{ship.ship}</b> е в {ship.portName}: {ship.delivered} от {ship.containers} контейнера са доставени. По-добро заплащане, а компанията с най-много контейнери взема награда в касата. Корабите са игрови данни.</span>
        </div>
      )}
      {lane && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-prestige/40 bg-prestige/10 px-4 py-3 text-sm">
          <span>
            {laneBoard.length
              ? <>Поръчки по линията <b>{laneBoard[0]!.origin.name} → {laneBoard[0]!.destination.name}</b> — поеми една до {Math.round(CONVOY_RULES.windowMs / 60_000)} мин след приятеля си и карате в конвой.</>
              : 'В момента няма свободна поръчка по тази линия. Опитай след малко — нови поръчки излизат постоянно.'}
          </span>
          <Link href="/game/contracts" className="btn-ghost px-3 py-1.5 text-xs">Всички поръчки</Link>
        </div>
      )}
      {fromCity && !lane && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-glow/40 bg-cyan-glow/10 px-4 py-3 text-sm">
          <span>
            {backBoard.length
              ? <>Обратен товар{fromName ? <> от <b>{fromName}</b></> : ''}{backTruck ? <> за <b>{backTruck.plate}</b></> : ''} — товарите, които камионът може да вземе, са първи{backBoard.some((c) => c.toHome) ? ', а тези към базата ти са отбелязани' : ''}.</>
              : `В момента няма поръчки${fromName ? ` от ${fromName}` : ''}. Виж всички поръчки — празният курс до съседен град често се изплаща.`}
          </span>
          <Link href="/game/contracts" className="btn-ghost px-3 py-1.5 text-xs">Всички поръчки</Link>
        </div>
      )}
      {!user.seenHints.includes('board') && <Hint id="board" />}
      <DispatchPanel freeTrucks={fleet.vehicles.filter((v) => !v.delivery && v.status === 'idle' && v.driver).length} />
      <FleetCondition rows={fleet.vehicles.map((v) => ({ id: v.id, plate: v.plate, model: v.model.name, city: v.city.nameBg, condition: v.condition, onTrip: !!v.delivery, rented: v.ownership === 'rented' }))} />
      <ContractBoard focus={params.load} initialChips={onlyFavorites ? ['fav'] : params.hired === '1' && hiredBy.size ? ['hired'] : []} canAssign={canAssign} vip={vip} localCityNames={[...new Set(fleet.vehicles.filter((v) => !v.delivery).map((v) => v.city.nameBg))]} contracts={lane ? laneBoard : fromCity ? backBoard : board} cargoTypes={Object.values(CARGO).map((c) => ({ id: c.id, label: c.label }))} />
    </div>
  );
}
