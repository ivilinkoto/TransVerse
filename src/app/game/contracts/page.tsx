import { Hint } from '@/components/game/Hint';
import { ContractBoard, type BoardContract } from '@/components/game/ContractBoard';
import { PageHeader } from '@/components/ui';
import { fuelPriceCents, legFuelPriceCents } from '@/lib/game/fuel';
import { CONDITION_LABELS, routeCondition } from '@/lib/game/winter';
import { convoyCandidates } from '@/server/game/convoy';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { combinationCapability } from '@/lib/game/catalog';
import { rentalFeeCents, tripCosts } from '@/lib/game/economy';
import { estimateGameMinutes } from '@/lib/game/schedule';
import { crewEffects, restLeftMin } from '@/lib/game/crew';
import { overloadPercent } from '@/lib/game/fines';
import { haversineKm } from '@/lib/geo/geometry';
import { gameContext } from '@/server/game/context';
import { ensureLocalJobsForFleet, openContracts } from '@/server/game/contracts';
import { compatibilityError, URGENT_RELOCATION_MS } from '@/server/game/deliveries';
import { and, eq } from 'drizzle-orm';
import { contracts as contractsTable, deliveries } from '@/server/db/schema';
import { fleetView } from '@/server/game/queries';
import { LICENCES } from '@/lib/game/licences';
import { isVip, VIP_PERKS } from '@/lib/game/vip';
import { heldLicences, missingFor } from '@/server/game/licences';

import { FleetCondition } from '@/components/game/FleetCondition';
import { DispatchPanel } from '@/components/game/DispatchPanel';
import { favoriteLanesOf } from '@/server/game/favorites';
import { membershipOf } from '@/server/game/membership';

export const metadata = { title: 'Поръчки' };

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ fav?: string }> }) {
  const onlyFavorites = (await searchParams).fav === '1';
  const { db, user, company, now } = await gameContext();
  const favorites = await favoriteLanesOf(db, user.id);
  // Lanes a friend or company member just left on (first one per lane).
  const convoys = new Map<string, string>();
  for (const c of await convoyCandidates(db, user.id, now)) if (!convoys.has(`${c.originCityId}:${c.destCityId}`)) convoys.set(`${c.originCityId}:${c.destCityId}`, c.username);
  // Every free vehicle always has at least one job it can take in its own city.
  await ensureLocalJobsForFleet(db, now, company.id).catch((e) => console.warn('[contracts] local jobs', e));
  const [fleet, licences, taken] = await Promise.all([
    fleetView(db, company.id),
    heldLicences(db, user.id),
    // Urgent shipments stay open after others take them; remember which ones this player already has.
    db.select({ contractId: deliveries.contractId }).from(deliveries).innerJoin(contractsTable, eq(contractsTable.id, deliveries.contractId)).where(and(eq(deliveries.companyId, company.id), eq(contractsTable.urgent, true))),
  ]);
  const takenIds = new Set(taken.map((t) => t.contractId));
  const vip = isVip(user.vipUntil, now);
  const hhmm = (d: Date) => d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Sofia' });
  const localCities = [...new Set(fleet.vehicles.filter((v) => !v.delivery).map((v) => v.cityId))];
  const membership = await membershipOf(db, user.id);
  const memberOfCompanyId = membership?.company.id ?? null;
  const [general, ...locals] = await Promise.all([openContracts(db, { limit: 250, memberOfCompanyId }), ...localCities.map((cityId) => openContracts(db, { originCityId: cityId, limit: 50, memberOfCompanyId }))]);
  const seen = new Set<string>();
  const contracts = [...locals.flat(), ...general].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  const board: BoardContract[] = contracts.map((c) => {
    const cargo = CARGO[c.cargoType as CargoType];
    const options = fleet.vehicles.map((v) => {
      const bundle = { modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: !!v.driver, status: v.status, trailerCondition: v.trailer?.condition ?? null };
      const strict = compatibilityError(bundle, c, user.level);
      // Up to 10 % over the payload is possible as a risk the player chooses.
      const overloadable = !!strict && compatibilityError(bundle, c, user.level, true) === null;
      const error = overloadable ? null : strict;
      // Planning estimates: empty leg by straight-line × 1.25, loaded leg from the real route.
      const emptyKm = v.cityId === c.originCityId ? 0 : haversineKm([v.city.lat, v.city.lon], [c.origin.lat, c.origin.lon]) * 1.25;
      const cap = combinationCapability({ unit: v.model, trailer: v.trailer?.model ?? null });
      // The urgent one-minute relocation is free; only the cargo leg costs.
      const chargedEmptyKm = c.urgent ? 0 : emptyKm;
      const crew = v.driver ? crewEffects(v.driver, v.coDriver, now) : undefined;
      const restMin = v.driver ? Math.max(restLeftMin(v.driver, now), v.coDriver ? restLeftMin(v.coDriver, now) : 0) : 0;
      const costs = tripCosts({ unit: v.model, trailer: v.trailer?.model ?? null, upgrades: v.upgrades, condition: v.condition, driverSkill: Math.max(v.driver?.skill ?? 1, v.coDriver?.skill ?? 0), crewFuel: crew?.fuel, crewWear: crew?.wear, emptyKm: chargedEmptyKm, loadedKm: c.distanceKm, tons: c.weightTons, payloadTons: cap.payloadTons || 1, tolledRoute: { empty: !c.urgent, loaded: c.route.hasToll }, fuelPrice: { empty: fuelPriceCents(v.city.countryCode, now), loaded: legFuelPriceCents(c.origin.countryCode, c.distanceKm, c.route.borders, now) } });
      // Urgent: one minute to the pickup city, then the cargo leg at the shipment's speed.
      // The crew changes the trip time: a tired driver rests early, a team drives on.
      const tripMinutes = (cr: typeof crew) => (c.urgent ? (emptyKm > 0 ? URGENT_RELOCATION_MS / 60_000 : 0) + estimateGameMinutes(0, c.distanceKm, cr) / Math.max(1, c.speedFactor) : estimateGameMinutes(emptyKm, c.distanceKm, cr));
      const minutes = tripMinutes(crew);
      // Without the due rest (a risk the player may take): the trip as with a rested crew.
      const rushMinutes = crew && crew.startDutyMin > 0 ? tripMinutes({ ...crew, startDutyMin: 0 }) : null;
      const rented = v.ownership === 'rented';
      const cost = rented ? rentalFeeCents(c.rewardCents, chargedEmptyKm + c.distanceKm) : costs.totalCents;
      return { vehicleId: v.id, label: `${v.plate} · ${v.model.name}${v.trailer ? ` + ${v.trailer.model.name}` : ''}${rented ? ' (нает)' : ''}${v.coDriver ? ' · екипаж' : ''} · ${v.city.nameBg} · ${Math.round(v.condition)}%${restMin ? ` · почива още ${restMin} мин` : ''}`, error, emptyKm: Math.round(emptyKm), costCents: cost, rented, profitCents: c.rewardCents - cost, minutes, rushMinutes, overloadPercent: overloadable ? Math.ceil(overloadPercent(c.weightTons, cap.payloadTons)) : 0 };
    });
    return {
      id: c.id,
      shipper: c.shipper,
      goods: c.goods,
      cargoType: c.cargoType as CargoType,
      cargoLabel: cargo.label,
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
      convoy: c.urgent ? null : (convoys.get(`${c.originCityId}:${c.destCityId}`) ?? null),
      weather: (() => {
        const w = routeCondition(c.route.countries, now);
        return w.condition === 'clear' ? null : { condition: w.condition, label: CONDITION_LABELS[w.condition], country: w.country! };
      })(),
      favorite: favorites.some((f) => f.originCityId === c.originCityId && f.destCityId === c.destCityId),
      tender: !!c.tenderId,
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

  return (
    <div>
      <PageHeader
        title="Поръчки"
        subtitle="Избери товар, камион и тръгвай. Поръчките са общи за всички играчи."
        help="Горивото се плаща по цените на държавите по маршрута (виж Финанси → Дизел днес). По пътя може да се случи задръстване, ремонт, повреда или опашка на границата — това забавя курса, а повредата струва пари за пътна помощ (при наетия камион плаща наемодателят). Общ пазар за всички играчи: поръчка, поета от друга компания, изчезва от борсата. Разстоянията са по реалната пътна мрежа (Valhalla / OpenStreetMap), освен ако не е отбелязано „приблизително“."
      />
      {!user.seenHints.includes('board') && <Hint id="board" />}
      <DispatchPanel freeTrucks={fleet.vehicles.filter((v) => !v.delivery && v.status === 'idle' && v.driver).length} />
      <FleetCondition rows={fleet.vehicles.map((v) => ({ id: v.id, plate: v.plate, model: v.model.name, city: v.city.nameBg, condition: v.condition, onTrip: !!v.delivery, rented: v.ownership === 'rented' }))} />
      <ContractBoard initialChips={onlyFavorites ? ['fav'] : []} vip={vip} localCityNames={[...new Set(fleet.vehicles.filter((v) => !v.delivery).map((v) => v.city.nameBg))]} contracts={board} cargoTypes={Object.values(CARGO).map((c) => ({ id: c.id, label: c.label }))} />
    </div>
  );
}
