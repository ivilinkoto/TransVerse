import { and, asc, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { SEALED } from '@/lib/game/deals';
import { CARGO, CARGO_TYPES, type BodyType, type CargoType } from '@/lib/game/cargo';
import { combinationCapability, powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { rewardCents } from '@/lib/game/economy';
import { PREMIUM_LEVELS } from '@/lib/game/progression';
import { haversineKm } from '@/lib/geo/geometry';
import { contractCountries, missingLicences, requiredLicences } from '@/lib/game/licences';
import { isVip, VIP_PERKS } from '@/lib/game/vip';
import { contractWindowMinutes } from '@/lib/game/schedule';
import { seasonalFactor } from '@/lib/game/seasonality';
import { isWinter, WINTER } from '@/lib/game/winter';
import { HALLOWEEN, isHalloween } from '@/lib/game/halloween';
import { CHRISTMAS, isChristmas } from '@/lib/game/christmas';
import { isMarta, MARTA } from '@/lib/game/marta';
import { EASTER, isEaster } from '@/lib/game/easter';
import { OVERSIZE } from '@/lib/game/roads';
import { payFactor } from '@/server/admin-economy';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, cityMarkets, companies, contracts, drivers, marketEvents, routes, trailers, users, vehicles } from '@/server/db/schema';
import { getCrossingRoute, getRoute, getRouteVia } from '@/server/geo/route-service';
import { crossingLine, islandOf } from '@/lib/game/crossings';
import { featureLive } from '@/lib/game/features';
import { DAILY_LOAD, sofiaDate, sofiaHourOf } from '@/lib/game/together';
import { MULTISTOP, splitTons, stopMultiplier, stopWindowMinutes, type ContractStop } from '@/lib/game/multistop';
import { HARVEST, isHarvest } from '@/lib/game/city-growth';
import { cityPay } from './city-growth';
import { isSowing, NATIONAL_DAY, nationalDayToday, SOWING } from '@/lib/game/spring';
import type { RoutingProvider } from '@/server/geo/routing';
import { licencesForUsers } from './licences';
import { shipperName } from './names';
import { notifyFavoriteLane } from './favorites';
import { broadcast } from './notify';
import { pick, pickWeighted, rand, randInt } from './random';
import { countryOpen } from '@/lib/geo/scope';
import { cycleIndex } from '@/lib/game/living';
import { t as tr } from '@/i18n/t';

/** Consignment size classes so vans, rigids and articulated trucks all have a market. */
const SIZE_CLASSES = [
  { id: 'van', maxTons: 1.3, maxKm: 450, weight: 0.3 },
  { id: 'rigid', maxTons: 7.5, maxKm: 900, weight: 0.3 },
  { id: 'full', maxTons: 40, maxKm: 1800, weight: 0.4 },
] as const;

export interface Hub {
  id: number;
  countryCode: string;
  lat: number;
  lon: number;
  population: number;
  produces: Set<CargoType>;
  consumes: Map<CargoType, number>; // demand
  /** v2.0: what the city has left to ship of each cargo it produces (1 = full). */
  supply?: Map<CargoType, number>;
}

// All hubs, read at most once a minute (the market reads them on every run; v1.7: 26 countries).
let hubCache: { at: number; hubs: Hub[] } | null = null;

/**
 * The freight hubs (cities with a market). Only the countries playable now:
 * the countries of "Цяла Европа" come in with the release (v1.7); the market
 * generator asks for them earlier, so the staff can test them.
 */
export async function loadHubs(db: DbOrTx, options: { europe?: boolean; openWorld?: boolean; now?: Date } = {}): Promise<Hub[]> {
  const europe = options.europe ?? featureLive('europe', options.now ?? new Date());
  const openWorld = options.openWorld ?? featureLive('open_world', options.now ?? new Date());
  const fresh = hubCache && Date.now() - hubCache.at < 60_000 && !process.env.VITEST ? hubCache.hubs : null;
  const all = fresh ?? (await readHubs(db));
  if (!fresh) hubCache = { at: Date.now(), hubs: all };
  return europe && openWorld ? all : all.filter((h) => countryOpen(h.countryCode, europe, openWorld));
}

async function readHubs(db: DbOrTx): Promise<Hub[]> {
  const rows = await db
    .select({ id: cities.id, countryCode: cities.countryCode, lat: cities.lat, lon: cities.lon, population: cities.population, cargoType: cityMarkets.cargoType, produces: cityMarkets.produces, consumes: cityMarkets.consumes, demand: cityMarkets.demand, supply: cityMarkets.supply })
    .from(cityMarkets)
    .innerJoin(cities, eq(cities.id, cityMarkets.cityId));
  const hubs = new Map<number, Hub>();
  for (const r of rows) {
    const hub = hubs.get(r.id) ?? { id: r.id, countryCode: r.countryCode, lat: r.lat, lon: r.lon, population: r.population, produces: new Set(), consumes: new Map(), supply: new Map() };
    if (r.produces) {
      hub.produces.add(r.cargoType as CargoType);
      hub.supply!.set(r.cargoType as CargoType, r.supply);
    }
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
  // Before the release the countries of "Цяла Европа" (v1.7) and of the east (v2.0) get only a few loads (seen by the staff only).
  const europe = featureLive('europe', now);
  const openWorld = featureLive('open_world', now);
  const hubs = await loadHubs(db, { europe: true, openWorld: true });
  const reach = (h: Hub) => (countryOpen(h.countryCode, europe, openWorld) ? 1 : 0.05);
  // v2.0 the living economy: a city that has shipped a lot has less to send for a while.
  const living = featureLive('living_economy', now);
  const supplyOf = (h: Hub, cargo?: CargoType) => (!living || !h.supply?.size ? 1 : cargo ? (h.supply.get(cargo) ?? 1) : [...h.supply.values()].reduce((s, v) => s + v, 0) / h.supply.size);
  const max = options.max ?? 20;
  let created = 0;

  for (let attempt = 0; attempt < max * 3 && created < max; attempt++) {
    const origin = options.originCityId
      ? hubs.find((h) => h.id === options.originCityId)
      : pickWeighted(hubs.filter((h) => h.produces.size), (h) => Math.sqrt(h.population) * reach(h) * supplyOf(h));
    if (!origin || origin.produces.size === 0) break;

    const size = options.sizeClass ? SIZE_CLASSES.find((s) => s.id === options.sizeClass)! : pickWeighted(SIZE_CLASSES, (s) => s.weight)!;
    const allowed: CargoType[] = size.id === 'van' ? ['pallets'] : size.id === 'rigid' ? ['pallets', 'refrigerated'] : [...CARGO_TYPES];
    const candidatesCargo = [...origin.produces].filter((c) => allowed.includes(c));
    if (!candidatesCargo.length) continue;
    const cargo = pickWeighted(candidatesCargo, (c) => supplyOf(origin, c)) ?? pick(candidatesCargo);

    const destination = pickWeighted(
      hubs.filter((h) => h.id !== origin.id && h.consumes.has(cargo) && (!options.domestic || h.countryCode === origin.countryCode)),
      (h) => {
        const km = haversineKm([origin.lat, origin.lon], [h.lat, h.lon]) * 1.25;
        if (km > size.maxKm || km < 20) return 0;
        return ((h.consumes.get(cargo) ?? 1) ** 2 * Math.sqrt(h.population) * (reach(origin) < 1 ? 1 : reach(h))) / (1 + km / 500);
      },
    );
    if (!destination) continue;

    const [minT, maxT] = CARGO[cargo].tons;
    const hi = Math.min(maxT, size.maxTons);
    const lo = Math.min(hi, size.id === 'full' ? Math.max(minT, 8) : minT);
    const tons = Math.round((lo + rand() * (hi - lo)) * 10) / 10;
    // Some market jobs are premium: better paid, only for players with enough reputation.
    const premium = rand() < PREMIUM_SHARE ? pickWeighted(PREMIUM_LEVELS.map((l, i) => ({ ...l, weight: [6, 3, 1][i] ?? 1 })), (l) => l.weight) ?? null : null;
    // Groupage: some longer loads drop part of the cargo in a city or two on the way.
    const via = !options.originCityId && rand() < MULTISTOP.share ? stopsOnTheWay(hubs, origin, destination, cargo, options.domestic) : [];
    if (await insertContract(db, origin, destination, cargo, tons, now, randInt(6, 30) * 3_600_000, options.provider, premium, via)) created++;
  }
  if (created) await broadcast(db, 'market');
  return created;
}

/** v2.0: a load between two hubs with a pay multiplier (intermodal legs). Returns the contract id, or null without a route. */
export function insertLoad(db: Database, origin: Hub, destination: Hub, cargo: CargoType, tons: number, now: Date, ttlMs: number, provider: RoutingProvider | undefined, multiplier: number, extra: { goods?: string } = {}) {
  return insertContract(db, origin, destination, cargo, tons, now, ttlMs, provider, { minReputation: 0, multiplier }, [], extra);
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
  // v1.7: more countries need a bigger board.
  const target = Math.round(Math.min(600, 120 + companiesCount * 8) * (featureLive('europe', now) ? 1.6 : 1));
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
    .where(and(eq(contracts.status, 'open'), eq(contracts.shady, false), eq(contracts.urgent, false), isNull(contracts.tenderId), eq(contracts.originCityId, need.cityId), gt(contracts.expiresAt, now), lte(contracts.weightTons, need.payloadTons), lte(contracts.minLevel, need.level), inArray(contracts.cargoType, compatible)))
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
  // On an island the guaranteed job stays on it when it can (no ferry needed).
  const island = islandOf(origin);
  const sameIsland = island ? hubs.filter((h) => h.id !== origin!.id && islandOf(h)?.id === island.id) : [];
  const others = sameIsland.length ? sameIsland : hubs.filter((h) => h.id !== origin!.id && (!domesticOnly || h.countryCode === origin!.countryCode) && !(island && islandOf(h)));
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
  if (!(await insertContract(db, origin, destination, cargo, tons, now, 12 * 3_600_000, provider))) return 0;
  await broadcast(db, 'market');
  return 1;
}

/**
 * Up to two cities near the straight line from origin to destination (by
 * distance from the origin) that take the cargo; none when the trip is short
 * or nothing fits without a long detour.
 */
export function stopsOnTheWay(hubs: Hub[], origin: Hub, destination: Hub, cargo: CargoType, domestic = false): Hub[] {
  const km = (a: Hub, b: Hub) => haversineKm([a.lat, a.lon], [b.lat, b.lon]);
  const direct = km(origin, destination);
  if (direct * 1.25 < MULTISTOP.minKm) return [];
  const fits = hubs
    .filter((h) => h.id !== origin.id && h.id !== destination.id && h.consumes.has(cargo) && (!domestic || h.countryCode === origin.countryCode))
    .filter((h) => km(origin, h) >= MULTISTOP.minLegKm && km(h, destination) >= MULTISTOP.minLegKm && (km(origin, h) + km(h, destination)) / direct <= MULTISTOP.maxDetour);
  const first = pickWeighted(fits, (h) => Math.sqrt(h.population));
  if (!first) return [];
  const stops = [first];
  if (MULTISTOP.maxStops > 1 && rand() < 0.4) {
    // A second drop between the first one and the destination.
    const second = pickWeighted(
      fits.filter((h) => h.id !== first.id && km(origin, h) > km(origin, first) + MULTISTOP.minLegKm && km(h, destination) >= MULTISTOP.minLegKm && (km(origin, first) + km(first, h) + km(h, destination)) / direct <= MULTISTOP.maxDetour),
      (h) => Math.sqrt(h.population),
    );
    if (second) stops.push(second);
  }
  return stops;
}

/** Share of market contracts that are premium (reputation required, better pay). */
export const PREMIUM_SHARE = 0.12;

/**
 * The route of a new load. An island (Crete, Rhodes…) is reached by ferry
 * from Piraeus (v1.4); between two different islands there is no load.
 */
async function loadRoute(db: Database, origin: Hub, destination: Hub, provider?: RoutingProvider) {
  const [ia, ib] = [islandOf(origin), islandOf(destination)];
  if (ia?.id === ib?.id) return getRoute(db, origin.id, destination.id, 'truck', provider);
  if (ia && ib) return null;
  const island = (ia ?? ib)!;
  const onIsland = ia ? origin : destination;
  const lines = island.lines.map((id) => crossingLine(id)!);
  const ports = await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, lines.map((l) => l.b)));
  const near = (l: (typeof lines)[number]) => {
    const p = ports.find((x) => x.id === l.b);
    return p ? haversineKm([p.lat, p.lon], [onIsland.lat, onIsland.lon]) : Infinity;
  };
  const line = [...lines].sort((x, y) => near(x) - near(y))[0]!;
  return getCrossingRoute(db, origin.id, destination.id, line, !!ia, 'truck', provider);
}

async function insertContract(db: Database, origin: Hub, destination: Hub, cargo: CargoType, tons: number, now: Date, ttlMs: number, provider?: RoutingProvider, premium: { minReputation: number; multiplier: number } | null = null, via: Hub[] = [], extra: { featured?: string; portCallId?: string; port?: boolean; oversize?: boolean; goods?: string; transEurope?: boolean; humanitarian?: boolean } = {}): Promise<string | null> {
  const sea = islandOf(origin)?.id !== islandOf(destination)?.id;
  if (sea) via = [];
  const viaRoute = via.length ? await getRouteVia(db, origin.id, via.map((h) => h.id), destination.id, 'truck', provider) : null;
  const route = viaRoute ?? (await loadRoute(db, origin, destination, provider));
  if (!route) return null;
  const parts = via.length ? splitTons(tons, via.length, rand) : [];
  const stops: ContractStop[] | null = viaRoute ? via.map((h, i) => ({ cityId: h.id, km: viaRoute.legKms[i]!, tons: parts[i]!, windowMinutes: stopWindowMinutes(viaRoute.legKms[i]!) })) : null;
  // Halloween and Christmas: some pallet and refrigerated loads are holiday goods that pay better.
  // Winter: some bulk, liquid and pallet loads are winter goods (salt, heating fuel, pellets…).
  const themes = [
    { id: 'halloween', goods: isHalloween(now) ? HALLOWEEN.goods[cargo] : undefined, share: HALLOWEEN.contractShare, multiplier: HALLOWEEN.rewardMultiplier },
    { id: 'christmas', goods: isChristmas(now) ? CHRISTMAS.goods[cargo] : undefined, share: CHRISTMAS.contractShare, multiplier: CHRISTMAS.rewardMultiplier },
    { id: 'easter', goods: isEaster(now) && featureLive('easter', now) ? EASTER.goods[cargo] : undefined, share: EASTER.contractShare, multiplier: EASTER.rewardMultiplier },
    { id: 'marta', goods: isMarta(now) && featureLive('marta', now) ? MARTA.goods[cargo] : undefined, share: MARTA.contractShare, multiplier: MARTA.rewardMultiplier },
    { id: 'winter', goods: isWinter(now) ? WINTER.goods[cargo] : undefined, share: WINTER.contractShare, multiplier: WINTER.rewardMultiplier },
    { id: 'sowing', goods: isSowing(now) && featureLive('sowing', now) ? SOWING.goods[cargo] : undefined, share: SOWING.contractShare, multiplier: SOWING.rewardMultiplier },
    { id: 'harvest', goods: isHarvest(now) && featureLive('harvest', now) ? HARVEST.goods[cargo] : undefined, share: HARVEST.contractShare, multiplier: HARVEST.rewardMultiplier },
  ];
  const theme = extra.featured || extra.oversize ? null : (themes.find((t) => t.goods && rand() < t.share) ?? null);
  // A national day of the destination country (v1.6): loads there pay more today.
  const national = !extra.featured && featureLive('national_days', now) ? nationalDayToday(now, destination.countryCode) : null;
  const holiday = theme?.id ?? (national ? 'national' : null);
  const market = (destination.consumes.get(cargo) ?? 1) * seasonalFactor(cargo, now) * (await eventMultiplier(db, now, destination.countryCode, cargo)) * (theme?.multiplier ?? 1) * (national ? NATIONAL_DAY.rewardMultiplier : 1);
  const goods = extra.goods ?? (theme ? pick(theme.goods!) : pick(CARGO[cargo].goods));
  // v1.8: now and then the shipper does not say what is inside.
  const sealed = !extra.featured && !extra.oversize && !extra.transEurope && !extra.humanitarian && !extra.portCallId && !theme && !via.length && featureLive('sealed_cargo', now) && rand() < SEALED.share;
  // The administrators' pay factor (v1.5 balance), 1 unless they changed it.
  // v1.10: loads from a city that has grown pay a little more.
  // v2.0: the economic cycle of the destination country.
  const cycle = featureLive('living_economy', now) ? cycleIndex(now, destination.countryCode) : 1;
  const reward = rewardCents(cargo, tons, route.distanceKm, market * cycle * (premium?.multiplier ?? 1) * stopMultiplier(via.length) * (await payFactor(db)) * (await cityPay(db, origin.id, now)));
  const [row] = await db.insert(contracts).values({
    shipper: shipperName(),
    goods,
    holiday,
    cargoType: cargo,
    weightTons: tons,
    originCityId: origin.id,
    destCityId: destination.id,
    routeId: route.id,
    distanceKm: route.distanceKm,
    rewardCents: reward,
    // Oversize loads drive slower (escort): their window is longer too.
    windowMinutes: Math.round(contractWindowMinutes(route.distanceKm) / (extra.oversize ? OVERSIZE.slower : 1)),
    minLevel: CARGO[cargo].minLevel,
    minReputation: premium?.minReputation ?? 0,
    stops,
    featured: extra.featured ?? null,
    portCallId: extra.portCallId ?? null,
    port: extra.port ?? false,
    oversize: extra.oversize ?? false,
    transEurope: extra.transEurope ?? false,
    sealed,
    humanitarian: extra.humanitarian ?? false,
    expiresAt: new Date(now.getTime() + ttlMs),
  }).returning({ id: contracts.id });
  const names = await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, [origin.id, destination.id]));
  const name = (id: number) => names.find((c) => c.id === id)?.nameBg ?? '';
  await notifyFavoriteLane(db, { contractId: row!.id, originCityId: origin.id, destCityId: destination.id, originName: name(origin.id), destName: name(destination.id), goods, rewardCents: reward }, now);
  return row!.id;
}

/** A load between two given cities (port loads, ship calls); null when there is no way (two different islands). */
export async function addLoad(db: Database, originId: number, destinationId: number, cargo: CargoType, tons: number, now: Date, ttlMs: number, multiplier: number, extra: { portCallId?: string; port?: boolean; oversize?: boolean; goods?: string; transEurope?: boolean; humanitarian?: boolean }, provider?: RoutingProvider, hubs?: Hub[]) {
  const all = hubs ?? (await loadHubs(db));
  const origin = all.find((h) => h.id === originId);
  const destination = all.find((h) => h.id === destinationId);
  if (!origin || !destination) return null;
  return insertContract(db, origin, destination, cargo, tons, now, ttlMs, provider, { minReputation: 0, multiplier }, [], extra);
}

/**
 * Worker: "Товар на деня" — from 12:00 (Sofia) one well-paid load between two
 * big cities, once a day (a unique key, so two workers cannot both make it).
 */
export async function ensureDailyLoad(db: Database, now = new Date(), provider?: RoutingProvider): Promise<string | null> {
  if (sofiaHourOf(now) < DAILY_LOAD.hour) return null;
  const key = `daily:${sofiaDate(now)}`;
  const [exists] = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.featured, key));
  if (exists) return null;
  const hubs = await loadHubs(db);
  const allowed = new Set<CargoType>(DAILY_LOAD.cargo);
  const origins = hubs.filter((h) => h.population >= 100_000 && !islandOf(h) && [...h.produces].some((c) => allowed.has(c)));
  for (let attempt = 0; attempt < 20; attempt++) {
    const origin = pickWeighted(origins, (h) => Math.sqrt(h.population));
    if (!origin) return null;
    const cargo = pick([...origin.produces].filter((c) => allowed.has(c)));
    const destination = pickWeighted(hubs.filter((h) => h.id !== origin.id && h.population >= 50_000 && !islandOf(h) && h.consumes.has(cargo)), (h) => {
      const km = haversineKm([origin.lat, origin.lon], [h.lat, h.lon]) * 1.25;
      return km < DAILY_LOAD.minKm || km > DAILY_LOAD.maxKm ? 0 : Math.sqrt(h.population);
    });
    if (!destination) continue;
    const [minT, maxT] = CARGO[cargo].tons;
    const hi = Math.min(maxT, 24);
    const tons = Math.round((Math.min(hi, Math.max(minT, 6)) + rand() * (hi - Math.min(hi, Math.max(minT, 6)))) * 10) / 10;
    try {
      const id = await insertContract(db, origin, destination, cargo, tons, now, DAILY_LOAD.ttlHours * 3_600_000, provider, { minReputation: 0, multiplier: DAILY_LOAD.multiplier }, [], { featured: key });
      if (!id) continue;
      await broadcast(db, 'market');
      return id;
    } catch (error) {
      // Another worker made it first (unique key).
      if ((error as { code?: string }).code === '23505' || /contracts_featured_idx/.test((error as Error).message)) return null;
      throw error;
    }
  }
  return null;
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
  // Personal licences plus those of the player's company.
  const licencesByUser: Map<string, Set<string>> = await licencesForUsers(db, [...new Set(rows.map((r) => r.userId))]);
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
    .where(and(eq(contracts.status, 'open'), eq(contracts.shady, false), isNull(contracts.tenderId), eq(contracts.originCityId, cityId), lte(contracts.weightTons, 1.3), eq(contracts.cargoType, 'pallets'), gt(contracts.expiresAt, now)));
  return n < 2 ? generateContracts(db, { now, max: 2 - n, originCityId: cityId, sizeClass: 'van', domestic: true, provider }) : 0;
}

export interface ContractFilter {
  cargoType?: CargoType;
  originCityId?: number;
  countryCode?: string;
  limit?: number;
  /** Player company of the viewer: its tender loads are included. */
  memberOfCompanyId?: string | null;
  /** Groupage loads too (default: once their release is out; staff see them earlier). */
  withStops?: boolean;
  /** The load of the day too (default: once its release is out). */
  withFeatured?: boolean;
  /** Loads over a ferry and port loads too (v1.4; default: once the release is out). */
  withSea?: boolean;
  /** Oversize loads too (v1.5; default: once the release is out). */
  /** Loads of companies this company hauls for (v1.5). */
  withContracts?: boolean;
  withOversize?: boolean;
  /** Own goods of other players on the freight exchange (v1.4). */
  withExchange?: boolean;
  /** The viewer: their own weekly rally load is included (v1.4). */
  viewerUserId?: string | null;
  /** Loads to and from the countries of "Цяла Европа" (v1.7). */
  withEurope?: boolean;
  /** v2.0: the countries of the east. */
  withOpenWorld?: boolean;
}

export async function openContracts(db: DbOrTx, filter: ContractFilter = {}, now = new Date()) {
  const conditions = [eq(contracts.status, 'open'), eq(contracts.shady, false), gt(contracts.expiresAt, now)];
  // Tender loads are only for the members of the company that accepted the tender.
  conditions.push(
    filter.memberOfCompanyId
      ? sql`(${contracts.tenderId} is null or ${contracts.tenderId} in (select id from company_tenders where company_id = ${filter.memberOfCompanyId}))`
      : isNull(contracts.tenderId),
  );
  if (filter.cargoType && CARGO_TYPES.includes(filter.cargoType)) conditions.push(eq(contracts.cargoType, filter.cargoType));
  if (filter.originCityId) conditions.push(eq(contracts.originCityId, filter.originCityId));
  if (!(filter.withStops ?? featureLive('multistop', now))) conditions.push(isNull(contracts.stops));
  if (!(filter.withFeatured ?? featureLive('daily_load', now))) conditions.push(isNull(contracts.featured));
  if (!(filter.withExchange ?? featureLive('freight_exchange', now))) conditions.push(eq(contracts.exchange, false));
  if (!(filter.withOversize ?? featureLive('oversize', now))) conditions.push(eq(contracts.oversize, false));
  const sea = filter.withSea ?? featureLive('ferries', now);
  const europe = filter.withEurope ?? featureLive('europe', now);
  const openWorld = filter.withOpenWorld ?? featureLive('open_world', now);
  if (!sea) conditions.push(eq(contracts.port, false));
  // Raw materials and product of a company factory are only for its members.
  conditions.push(filter.viewerUserId ? sql`(${contracts.rallyId} is null or ${contracts.createdBy} = ${filter.viewerUserId})` : isNull(contracts.rallyId));
  // Members-only loads: own company's, and (v1.5) those of the companies this one hauls for.
  const clients = filter.memberOfCompanyId && (filter.withContracts ?? featureLive('company_contracts', now)) ? sql`(select client_org_id from company_contracts where hauler_org_id = ${filter.memberOfCompanyId} and status = 'active' and ends_at > ${now})` : null;
  conditions.push(filter.memberOfCompanyId ? sql`(${contracts.factoryOrgId} is null or ${contracts.factoryOrgId} = ${filter.memberOfCompanyId}${clients ? sql` or ${contracts.factoryOrgId} in ${clients}` : sql``})` : isNull(contracts.factoryOrgId));
  conditions.push(filter.memberOfCompanyId ? sql`(${contracts.branchOrgId} is null or ${contracts.branchOrgId} = ${filter.memberOfCompanyId}${clients ? sql` or ${contracts.branchOrgId} in ${clients}` : sql``})` : isNull(contracts.branchOrgId));
  // Loads shared with a company are only for its members.
  conditions.push(
    filter.memberOfCompanyId
      ? sql`(${contracts.sharedLoadId} is null or ${contracts.sharedLoadId} in (select id from shared_loads where organization_id = ${filter.memberOfCompanyId}))`
      : isNull(contracts.sharedLoadId),
  );
  // Building materials are only for the members of the company that builds.
  conditions.push(
    filter.memberOfCompanyId
      ? sql`(${contracts.constructionId} is null or ${contracts.constructionId} in (select id from company_builds where organization_id = ${filter.memberOfCompanyId}))`
      : isNull(contracts.constructionId),
  );
  const rows = await db.query.contracts.findMany({
    where: and(...conditions),
    orderBy: [desc(sql`${contracts.featured} is not null`), desc(contracts.urgent), desc(contracts.rewardCents), asc(contracts.expiresAt)],
    limit: Math.min(filter.limit ?? 150, 300),
  });
  const cityIds = [...new Set(rows.flatMap((r) => [r.originCityId, r.destCityId, ...(r.stops ?? []).map((st) => st.cityId)]))];
  const cityRows = cityIds.length ? await db.select().from(cities).where(inArray(cities.id, cityIds)) : [];
  const routeIds = [...new Set(rows.map((r) => r.routeId))];
  const routeRows = routeIds.length ? await db.select({ id: routes.id, provider: routes.provider, hasToll: routes.hasToll, borders: routes.borders, durationS: routes.durationS, countries: routes.countries, crossing: routes.crossing, profile: routes.profile }).from(routes).where(inArray(routes.id, routeIds)) : [];
  const cityMap = new Map(cityRows.map((c) => [c.id, c]));
  const routeMap = new Map(routeRows.map((r) => [r.id, r]));
  return rows
    .map((r) => ({ ...r, origin: cityMap.get(r.originCityId)!, destination: cityMap.get(r.destCityId)!, route: routeMap.get(r.routeId)!, stopCities: (r.stops ?? []).map((st) => ({ ...st, name: cityMap.get(st.cityId)?.nameBg ?? '', country: cityMap.get(st.cityId)?.countryCode ?? '' })) }))
    .filter((r) => !filter.countryCode || r.origin.countryCode === filter.countryCode || r.destination.countryCode === filter.countryCode)
    // Loads over a ferry wait for the release (staff see them earlier).
    .filter((r) => sea || !r.route.crossing)
    // So do the loads of "Цяла Европа" (v1.7) and of the east (v2.0).
    .filter((r) => [r.origin.countryCode, r.destination.countryCode, ...r.stopCities.map((s) => s.country)].every((c) => countryOpen(c, europe, openWorld)));
}

export type ContractView = Awaited<ReturnType<typeof openContracts>>[number];

/** VIP: holds an open (non-urgent) contract for the player for a few minutes. One reservation at a time. */
export async function reserveContract(db: Database, userId: string, contractId: string, now = new Date()) {
  const { companyForUser } = await import('./company');
  const { fail } = await import('./errors');
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ vipUntil: users.vipUntil }).from(users).where(eq(users.id, userId));
    if (!isVip(user?.vipUntil, now)) fail('vip_only', tr('Запазването на поръчки е VIP възможност.'), 403);
    const account = await companyForUser(tx, userId);
    const [c] = await tx.select().from(contracts).where(eq(contracts.id, contractId)).for('update');
    if (!c || c.status !== 'open' || c.expiresAt <= now) fail('contract_unavailable', tr('Поръчката вече не е налична.'), 409);
    if (c!.urgent) fail('urgent', tr('Спешните поръчки не се запазват — може да ги поеме всеки.'));
    if (c!.reservedUntil && c!.reservedUntil > now && c!.reservedByCompanyId !== account.id) fail('reserved', tr('Поръчката вече е запазена от друг играч.'), 409);
    // Only one reservation at a time: release any other one.
    await tx.update(contracts).set({ reservedByCompanyId: null, reservedUntil: null }).where(and(eq(contracts.reservedByCompanyId, account.id), sql`${contracts.id} <> ${contractId}`));
    const until = new Date(now.getTime() + VIP_PERKS.reservationMinutes * 60_000);
    await tx.update(contracts).set({ reservedByCompanyId: account.id, reservedUntil: until }).where(eq(contracts.id, contractId));
    await broadcast(tx, 'market');
    return until;
  });
}
