import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { CARGO, CARGO_TYPES, type CargoType } from '@/lib/game/cargo';
import { rewardCents } from '@/lib/game/economy';
import { haversineKm } from '@/lib/geo/geometry';
import { contractWindowMinutes } from '@/lib/game/schedule';
import { seasonalFactor } from '@/lib/game/seasonality';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, cityMarkets, companies, contracts, marketEvents, routes } from '@/server/db/schema';
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
      hubs.filter((h) => h.id !== origin.id && h.consumes.has(cargo)),
      (h) => {
        const km = haversineKm([origin.lat, origin.lon], [h.lat, h.lon]) * 1.25;
        if (km > size.maxKm || km < 20) return 0;
        return (h.consumes.get(cargo) ?? 1) ** 2 * Math.sqrt(h.population) / (1 + km / 500);
      },
    );
    if (!destination) continue;

    const route = await getRoute(db, origin.id, destination.id, 'truck', options.provider);
    const [minT, maxT] = CARGO[cargo].tons;
    const hi = Math.min(maxT, size.maxTons);
    const lo = Math.min(hi, size.id === 'full' ? Math.max(minT, 8) : minT);
    const tons = Math.round((lo + rand() * (hi - lo)) * 10) / 10;

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
      expiresAt: new Date(now.getTime() + randInt(6, 30) * 3_600_000),
    });
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

/** Onboarding guarantee: a company HQ always has at least two van-sized jobs available. */
export async function ensureStarterJobs(db: Database, cityId: number, now = new Date(), provider?: RoutingProvider) {
  const [{ n = 0 } = {}] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contracts)
    .where(and(eq(contracts.status, 'open'), eq(contracts.originCityId, cityId), lte(contracts.weightTons, 1.3), eq(contracts.cargoType, 'pallets'), gt(contracts.expiresAt, now)));
  return n < 2 ? generateContracts(db, { now, max: 2 - n, originCityId: cityId, sizeClass: 'van', provider }) : 0;
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
    orderBy: [desc(contracts.rewardCents), asc(contracts.expiresAt)],
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
