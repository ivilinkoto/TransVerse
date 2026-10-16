import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { CARGO, CARGO_TYPES, type BodyType, type CargoType } from '@/lib/game/cargo';
import { combinationCapability, powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { rewardCents } from '@/lib/game/economy';
import { haversineKm } from '@/lib/geo/geometry';
import { contractCountries, missingLicences, requiredLicences } from '@/lib/game/licences';
import { contractWindowMinutes } from '@/lib/game/schedule';
import { seasonalFactor } from '@/lib/game/seasonality';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, cityMarkets, companies, contracts, drivers, marketEvents, routes, trailers, userLicences, users, vehicles } from '@/server/db/schema';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { shipperName } from './names';
import { broadcast } from './notify';
import { pick, pickWeighted, rand, randInt } from './random';

/** Consignment size classes so vans, rigids and articulated trucks all have a market. */
const SIZE_CLASSES = [
  { id: 'van', maxTons: 1.3, maxKm: 450, weight: 0.3 },
  { id: 'rigid', maxTons: 7.5, maxKm: 900, weight: 0.3 },
  { id: 'full', maxTons: 40, maxKm: 1800, weight: 0.4 },
] as const;

interface Hub {
  id: number;
  countryCode: string;
  lat: number;
  lon: number;
  population: number;
  produces: Set<CargoType>;
  consumes: Map<CargoType, number>; // demand
}

async function loadHubs(db: DbOrTx): Promise<Hub[]> {
  const rows = await db
    .select({ id: cities.id, countryCode: cities.countryCode, lat: cities.lat, lon: cities.lon, population: cities.population, cargoType: cityMarkets.cargoType, produces: cityMarkets.produces, consumes: cityMarkets.consumes, demand: cityMarkets.demand })
    .from(cityMarkets)
    .innerJoin(cities, eq(cities.id, cityMarkets.cityId));
  const hubs = new Map<number, Hub>();
  for (const r of rows) {
    const hub = hubs.get(r.id) ?? { id: r.id, countryCode: r.countryCode, lat: r.lat, lon: r.lon, population: r.population, produces: new Set(), consumes: new Map() };
    if (r.produces) hub.produces.add(r.cargoType as CargoType);
    if (r.consumes) hub.consumes.set(r.cargoType as CargoType, r.demand);
    hubs.set(r.id, hub);
  }
  return [...hubs.values()];
}

async function eventMultiplier(db: DbOrTx, now: Date, country: string, cargo: CargoType): Promise<number> {
  const events = await db
    .select({ multiplier: marketEvents.multiplier, countryCode: marketEvents.countryCode, cargoType: marketEvents.cargoType })
    .from(marketEvents)
    .where(and(lte(marketEvents.startsAt, now), gt(marketEvents.endsAt, now)));
  return events
    .filter((e) => (!e.countryCode || e.countryCode === country) && (!e.cargoType || e.cargoType === cargo))
    .reduce((m, e) => m * e.multiplier, 1);
}

export interface GenerateOptions {
  now?: Date;
  /** Upper bound on new contracts in this run (each may need a routing call). */
  max?: number;
  /** Force origin (used for onboarding near a new company). */
  originCityId?: number;
  sizeClass?: (typeof SIZE_CLASSES)[number]['id'];
  /** Only destinations in the origin's country (jobs that need no cross-border licence). */
  domestic?: boolean;
  provider?: RoutingProvider;
}

/** Generates new market contracts between real cities. Returns how many were created. */
export async function generateContracts(db: Database, options: GenerateOptions = {}): Promise<number> {
  const now = options.now ?? new Date();
  const hubs = await loadHubs(db);
  const max = options.max ?? 20;
  let created = 0;

  for (let attempt = 0; attempt < max * 3 && created < max; attempt++) {
    const origin = options.originCityId
      ? hubs.find((h) => h.id === options.originCityId)
      : pickWeighted(hubs.filter((h) => h.produces.size), (h) => Math.sqrt(h.population));
    if (!origin || origin.produces.size === 0) break;

    const size = options.sizeClass ? SIZE_CLASSES.find((s) => s.id === options.sizeClass)! : pickWeighted(SIZE_CLASSES, (s) => s.weight)!;
    const allowed: CargoType[] = size.id === 'van' ? ['pallets'] : size.id === 'rigid' ? ['pallets', 'refrigerated'] : [...CARGO_TYPES];
    const candidatesCargo = [...origin.produces].filter((c) => allowed.includes(c));
    if (!candidatesCargo.length) continue;
    const cargo = pick(candidatesCargo);

    const destination = pickWeighted(
      hubs.filter((h) => h.id !== origin.id && h.consumes.has(cargo) && (!options.domestic || h.countryCode === origin.countryCode)),
      (h) => {
        const km = haversineKm([origin.lat, origin.lon], [h.lat, h.lon]) * 1.25;
        if (km > size.maxKm || km < 20) return 0;
        return (h.consumes.get(cargo) ?? 1) ** 2 * Math.sqrt(h.population) / (1 + km / 500);
      },
    );
    if (!destination) continue;

    const [minT, maxT] = CARGO[cargo].tons;
    const hi = Math.min(maxT, size.maxTons);
    const lo = Math.min(hi, size.id === 'full' ? Math.max(minT, 8) : minT);
    const tons = Math.round((lo + rand() * (hi - lo)) * 10) / 10;
    await insertContract(db, origin, destination, cargo, tons, now, randInt(6, 30) * 3_600_000, options.provider);
    created++;
  }
  if (created) await broadcast(db, 'market');
  return created;
}

export async function expireContracts(db: DbOrTx, now = new Date()): Promise<number> {
  const rows = await db.update(contracts).set({ status: 'expired' }).where(and(eq(contracts.status, 'open'), lte(contracts.expiresAt, now))).returning({ id: contracts.id });
  return rows.length;
}

/** Keeps the shared board stocked; also guarantees small jobs near every company HQ. */
export async function replenishMarket(db: Database, now = new Date(), provider?: RoutingProvider) {
  await expireContracts(db, now);
  const [{ open = 0, companiesCount = 0 } = {}] = await db
    .select({ open: sql<number>`(select count(*) from ${contracts} where ${contracts.status} = 'open')::int`, companiesCount: sql<number>`(select count(*) from ${companies})::int` })
    .from(sql`(select 1) as one`);
  const target = Math.min(600, 120 + companiesCount * 8);
  let created = 0;
  if (open < target) created += await generateContracts(db, { now, max: Math.min(25, target - open), provider });

  const hqs = await db.selectDistinct({ cityId: companies.hqCityId }).from(companies);
  for (const { cityId } of hqs) created += await ensureStarterJobs(db, cityId, now, provider);
  return created;
}

export interface LocalNeed {
  cityId: number;
  bodies: BodyType[];
  payloadTons: number;
  level: number;
  /** Licences the player holds; jobs needing others do not count. */
  licences: ReadonlySet<string>;
}

/**
 * Guarantee: wherever a player's free vehicle stands, there is at least one
 * open contract from that city it can actually take — whatever the reward or
 * the distance. Creates one when missing. Returns how many were created.
 */
export async function ensureLocalJob(db: Database, need: LocalNeed, now = new Date(), provider?: RoutingProvider): Promise<number> {
  const compatible = CARGO_TYPES.filter(
    (c) => CARGO[c].minLevel <= need.level && CARGO[c].bodies.some((b) => need.bodies.includes(b)) && missingLicences(requiredLicences(c, []), need.licences).length === 0,
  );
  if (!compatible.length || need.payloadTons <= 0) return 0;
  const candidates = await db
    .select({ cargoType: contracts.cargoType, routeCountries: routes.countries, destCountry: cities.countryCode })
    .from(contracts)
    .innerJoin(routes, eq(routes.id, contracts.routeId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(and(eq(contracts.status, 'open'), eq(contracts.urgent, false), eq(contracts.originCityId, need.cityId), gt(contracts.expiresAt, now), lte(contracts.weightTons, need.payloadTons), lte(contracts.minLevel, need.level), inArray(contracts.cargoType, compatible)))
    .limit(50);
  const [here] = await db.select({ country: cities.countryCode }).from(cities).where(eq(cities.id, need.cityId));
  if (!here) return 0;
  const doable = candidates.some((c) => missingLicences(requiredLicences(c.cargoType, contractCountries(here.country, c.destCountry, c.routeCountries)), need.licences).length === 0);
  if (doable) return 0;

  const hubs = await loadHubs(db);
  let origin = hubs.find((h) => h.id === need.cityId);
  if (!origin) {
    const [city] = await db.select().from(cities).where(eq(cities.id, need.cityId));
    if (!city) return 0;
    origin = { id: city.id, countryCode: city.countryCode, lat: city.lat, lon: city.lon, population: city.population, produces: new Set(), consumes: new Map() };
  }
  const local = compatible.filter((c) => origin!.produces.has(c));
  const cargo = pick(local.length ? local : compatible);
  // Without cross-border licences the guaranteed job stays inside the country.
  const domesticOnly = !need.licences.has('international') || !need.licences.has('customs');
  const others = hubs.filter((h) => h.id !== origin!.id && (!domesticOnly || h.countryCode === origin!.countryCode));
  const weight = (h: Hub) => {
    const km = haversineKm([origin!.lat, origin!.lon], [h.lat, h.lon]);
    return km < 15 ? 0 : Math.sqrt(h.population) / (1 + km / 400);
  };
  // Any distance is fine; consumers of the cargo first, otherwise any city.
  const destination = pickWeighted(others.filter((h) => h.consumes.has(cargo)), weight) ?? pickWeighted(others, weight);
  if (!destination) return 0;

  const [minT, maxT] = CARGO[cargo].tons;
  const hi = Math.min(maxT, need.payloadTons);
  const lo = Math.min(hi, Math.max(0.2, minT));
  const tons = Math.round((lo + rand() * (hi - lo)) * 10) / 10;
  await insertContract(db, origin, destination, cargo, tons, now, 12 * 3_600_000, provider);
  await broadcast(db, 'market');
  return 1;
}

async function insertContract(db: Database, origin: Hub, destination: Hub, cargo: CargoType, tons: number, now: Date, ttlMs: number, provider?: RoutingProvider) {
  const route = await getRoute(db, origin.id, destination.id, 'truck', provider);
  const market = (destination.consumes.get(cargo) ?? 1) * seasonalFactor(cargo, now) * (await eventMultiplier(db, now, destination.countryCode, cargo));
  await db.insert(contracts).values({
    shipper: shipperName(),
    goods: pick(CARGO[cargo].goods),
    cargoType: cargo,
    weightTons: tons,
    originCityId: origin.id,
    destCityId: destination.id,
    routeId: route.id,
    distanceKm: route.distanceKm,
    rewardCents: rewardCents(cargo, tons, route.distanceKm, market),
    windowMinutes: contractWindowMinutes(route.distanceKm),
    minLevel: CARGO[cargo].minLevel,
    expiresAt: new Date(now.getTime() + ttlMs),
  });
}

/** Runs the local-job guarantee for every free, crewed vehicle (optionally of one company). */
export async function ensureLocalJobsForFleet(db: Database, now = new Date(), companyId?: string, provider?: RoutingProvider, limit = 40): Promise<number> {
  const rows = await db
    .select({ cityId: vehicles.cityId, modelId: vehicles.modelId, vehicleId: vehicles.id, level: users.level, userId: users.id })
    .from(vehicles)
    .innerJoin(drivers, eq(drivers.vehicleId, vehicles.id))
    .innerJoin(companies, eq(companies.id, vehicles.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(vehicles.status, 'idle'), isNull(vehicles.soldAt), companyId ? eq(vehicles.companyId, companyId) : undefined))
    .limit(limit);
  if (!rows.length) return 0;
  const coupled = await db.select().from(trailers).where(inArray(trailers.vehicleId, rows.map((r) => r.vehicleId)));
  const held = await db.select().from(userLicences).where(inArray(userLicences.userId, [...new Set(rows.map((r) => r.userId))]));
  const licencesByUser = new Map<string, Set<string>>();
  for (const h of held) licencesByUser.set(h.userId, (licencesByUser.get(h.userId) ?? new Set()).add(h.licence));
  const seen = new Set<string>();
  let created = 0;
  for (const r of rows) {
    const unit = powerUnitModel(r.modelId);
    const t = coupled.find((x) => x.vehicleId === r.vehicleId);
    const cap = combinationCapability({ unit, trailer: t ? trailerModel(t.modelId) : null });
    const licences = licencesByUser.get(r.userId) ?? new Set<string>();
    const key = `${r.cityId}:${cap.bodies.join(',')}:${cap.payloadTons}:${r.level}:${[...licences].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    created += await ensureLocalJob(db, { cityId: r.cityId, bodies: cap.bodies, payloadTons: cap.payloadTons, level: r.level, licences }, now, provider);
  }
  return created;
}

/** Onboarding guarantee: a company HQ always has at least two van-sized jobs available. */
export async function ensureStarterJobs(db: Database, cityId: number, now = new Date(), provider?: RoutingProvider) {
  const [{ n = 0 } = {}] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contracts)
    .where(and(eq(contracts.status, 'open'), eq(contracts.originCityId, cityId), lte(contracts.weightTons, 1.3), eq(contracts.cargoType, 'pallets'), gt(contracts.expiresAt, now)));
  return n < 2 ? generateContracts(db, { now, max: 2 - n, originCityId: cityId, sizeClass: 'van', domestic: true, provider }) : 0;
}

export interface ContractFilter {
  cargoType?: CargoType;
  originCityId?: number;
  countryCode?: string;
  limit?: number;
}

export async function openContracts(db: DbOrTx, filter: ContractFilter = {}, now = new Date()) {
  const conditions = [eq(contracts.status, 'open'), gt(contracts.expiresAt, now)];
  if (filter.cargoType && CARGO_TYPES.includes(filter.cargoType)) conditions.push(eq(contracts.cargoType, filter.cargoType));
  if (filter.originCityId) conditions.push(eq(contracts.originCityId, filter.originCityId));
  const rows = await db.query.contracts.findMany({
    where: and(...conditions),
    orderBy: [desc(contracts.urgent), desc(contracts.rewardCents), asc(contracts.expiresAt)],
    limit: Math.min(filter.limit ?? 150, 300),
  });
  const cityIds = [...new Set(rows.flatMap((r) => [r.originCityId, r.destCityId]))];
  const cityRows = cityIds.length ? await db.select().from(cities).where(inArray(cities.id, cityIds)) : [];
  const routeIds = [...new Set(rows.map((r) => r.routeId))];
  const routeRows = routeIds.length ? await db.select({ id: routes.id, provider: routes.provider, hasToll: routes.hasToll, borders: routes.borders, durationS: routes.durationS, countries: routes.countries }).from(routes).where(inArray(routes.id, routeIds)) : [];
  const cityMap = new Map(cityRows.map((c) => [c.id, c]));
  const routeMap = new Map(routeRows.map((r) => [r.id, r]));
  return rows
    .map((r) => ({ ...r, origin: cityMap.get(r.originCityId)!, destination: cityMap.get(r.destCityId)!, route: routeMap.get(r.routeId)! }))
    .filter((r) => !filter.countryCode || r.origin.countryCode === filter.countryCode || r.destination.countryCode === filter.countryCode);
}

export type ContractView = Awaited<ReturnType<typeof openContracts>>[number];
