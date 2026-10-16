import { ContractBoard, type BoardContract } from '@/components/game/ContractBoard';
import { PageHeader } from '@/components/ui';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { combinationCapability } from '@/lib/game/catalog';
import { rentalFeeCents, tripCosts } from '@/lib/game/economy';
import { gameDurationMinutes } from '@/lib/game/schedule';
import { haversineKm } from '@/lib/geo/geometry';
import { gameContext } from '@/server/game/context';
import { ensureLocalJobsForFleet, openContracts } from '@/server/game/contracts';
import { compatibilityError } from '@/server/game/deliveries';
import { fleetView } from '@/server/game/queries';
import { LICENCES } from '@/lib/game/licences';
import { heldLicences, missingFor } from '@/server/game/licences';

export const metadata = { title: 'Транспортни поръчки' };

export default async function ContractsPage() {
  const { db, user, company, now } = await gameContext();
  // Every free vehicle always has at least one job it can take in its own city.
  await ensureLocalJobsForFleet(db, now, company.id).catch((e) => console.warn('[contracts] local jobs', e));
  const [fleet, licences] = await Promise.all([fleetView(db, company.id), heldLicences(db, user.id)]);
  const localCities = [...new Set(fleet.vehicles.filter((v) => !v.delivery).map((v) => v.cityId))];
  const [general, ...locals] = await Promise.all([openContracts(db, { limit: 250 }), ...localCities.map((cityId) => openContracts(db, { originCityId: cityId, limit: 50 }))]);
  const seen = new Set<string>();
  const contracts = [...locals.flat(), ...general].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  const board: BoardContract[] = contracts.map((c) => {
    const cargo = CARGO[c.cargoType as CargoType];
    const options = fleet.vehicles.map((v) => {
      const error = compatibilityError(
        { modelId: v.modelId, trailerModelId: v.trailer?.modelId ?? null, condition: v.condition, hasDriver: !!v.driver, status: v.status },
        c,
        user.level,
      );
      // Planning estimates: empty leg by straight-line × 1.25, loaded leg from the real route.
      const emptyKm = v.cityId === c.originCityId ? 0 : haversineKm([v.city.lat, v.city.lon], [c.origin.lat, c.origin.lon]) * 1.25;
      const cap = combinationCapability({ unit: v.model, trailer: v.trailer?.model ?? null });
      const costs = tripCosts({ unit: v.model, trailer: v.trailer?.model ?? null, upgrades: v.upgrades, condition: v.condition, driverSkill: v.driver?.skill ?? 1, emptyKm, loadedKm: c.distanceKm, tons: c.weightTons, payloadTons: cap.payloadTons || 1, tolledRoute: { empty: true, loaded: c.route.hasToll } });
      const minutes = gameDurationMinutes(emptyKm + c.distanceKm) / Math.max(1, c.speedFactor);
      const rented = v.ownership === 'rented';
      const cost = rented ? rentalFeeCents(c.rewardCents, emptyKm + c.distanceKm) : costs.totalCents;
      return { vehicleId: v.id, label: `${v.plate} · ${v.model.name}${v.trailer ? ` + ${v.trailer.model.name}` : ''}${rented ? ' (нает)' : ''} · ${v.city.nameBg}`, error, emptyKm: Math.round(emptyKm), costCents: cost, rented, profitCents: c.rewardCents - cost, minutes };
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
      locked: user.level < Math.max(c.minLevel, cargo.minLevel),
      local: localCities.includes(c.originCityId),
      urgent: c.urgent,
      speedFactor: c.speedFactor,
      missingLicences: missingFor({ cargoType: c.cargoType, originCountry: c.origin.countryCode, destCountry: c.destination.countryCode, routeCountries: c.route.countries }, licences).map((id) => LICENCES[id].short),
      options,
    };
  });

  return (
    <div>
      <PageHeader
        title="Транспортни поръчки"
        subtitle="Общ пазар за всички играчи: поръчка, поета от друга компания, изчезва от борсата. Разстоянията са по реалната пътна мрежа (Valhalla / OpenStreetMap), освен ако не е отбелязано „приблизително“."
      />
      <ContractBoard localCityNames={[...new Set(fleet.vehicles.filter((v) => !v.delivery).map((v) => v.city.nameBg))]} contracts={board} cargoTypes={Object.values(CARGO).map((c) => ({ id: c.id, label: c.label }))} />
    </div>
  );
}
