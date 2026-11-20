import { and, eq, gt, gte, inArray, isNotNull, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, driverWishes, drivers, trailers, users, vehicles } from '@/server/db/schema';
import { combinationCapability, powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { licencesForUsers } from './licences';
import { featureLive } from '@/lib/game/features';
import { WISHES, WISH_REASONS } from '@/lib/game/wishes';
import { haversineKm } from '@/lib/geo/geometry';
import { t, tx } from '@/i18n/t';
import { loadHubs, wishLoad } from './contracts';
import { notify } from './notify';

/** A driver's truck: where it stands, what it can carry, and what its owner may drive. */
async function truckOf(db: DbOrTx, driverId: string) {
  const [row] = await db
    .select({ vehicleId: vehicles.id, cityId: vehicles.cityId, status: vehicles.status, modelId: vehicles.modelId, companyId: vehicles.companyId, ownerId: companies.ownerId, level: users.level })
    .from(drivers)
    .innerJoin(vehicles, or(eq(vehicles.id, drivers.vehicleId), eq(vehicles.id, drivers.coVehicleId)))
    .innerJoin(companies, eq(companies.id, vehicles.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(drivers.id, driverId), isNull(vehicles.soldAt)));
  if (!row) return null;
  const [trailer] = await db.select({ modelId: trailers.modelId }).from(trailers).where(eq(trailers.vehicleId, row.vehicleId));
  const cap = combinationCapability({ unit: powerUnitModel(row.modelId), trailer: trailer ? trailerModel(trailer.modelId) : null });
  const licences = (await licencesForUsers(db, [row.ownerId])).get(row.ownerId) ?? new Set<string>();
  return { ...row, ...cap, licences };
}

/** Without cross-border licences a wish stays inside the country (the player could not take the load). */
const crossBorder = (licences: ReadonlySet<string>) => licences.has('international') && licences.has('customs');

/**
 * The load for an open wish: from where the driver's truck stands to the city,
 * held for the company until the wish ends. Made again if the truck moved and
 * the load is gone; nothing while one is still on the board or on the way.
 */
export async function ensureWishLoad(db: Database, wish: { driverId: string; companyId: string; cityId: number; until: Date }, now = new Date()) {
  if (wish.until <= now) return null;
  const [held] = await db
    .select({ id: contracts.id })
    .from(contracts)
    .where(and(eq(contracts.destCityId, wish.cityId), eq(contracts.reservedByCompanyId, wish.companyId), eq(contracts.status, 'open'), gt(contracts.reservedUntil, now), gt(contracts.expiresAt, now)))
    .limit(1);
  if (held) return held.id;
  const truck = await truckOf(db, wish.driverId);
  if (!truck || truck.status !== 'idle') return null;
  return wishLoad(db, { cityId: truck.cityId, bodies: truck.bodies, payloadTons: truck.payloadTons, level: truck.level, licences: truck.licences, companyId: wish.companyId }, wish.cityId, wish.until, now);
}

/** Worker: every open wish keeps a load to its city that the driver's truck can take. */
export async function ensureWishLoads(db: Database, now = new Date()) {
  if (!featureLive('driver_wishes', now)) return 0;
  const open = await db.select().from(driverWishes).where(and(eq(driverWishes.status, 'open'), gt(driverWishes.until, now)));
  let made = 0;
  for (const w of open) if (await ensureWishLoad(db, w, now).catch(() => null)) made++;
  return made;
}

/**
 * 1.1.4.2 „Желанията на шофьорите“: once a day some hired drivers ask for a
 * trip to a big city not far from where their truck stands, within three days.
 * A load there waits on the board, held for the player's company.
 */
export async function spawnWishes(db: Database, now = new Date(), rand: () => number = Math.random) {
  if (!featureLive('driver_wishes', now)) return 0;
  const open = db.select({ id: driverWishes.driverId }).from(driverWishes).where(eq(driverWishes.status, 'open'));
  const candidates = await db
    .select({ id: drivers.id, name: drivers.name, companyId: drivers.companyId, ownerId: companies.ownerId })
    .from(drivers)
    .innerJoin(companies, eq(companies.id, drivers.companyId))
    .where(and(eq(drivers.isOwner, false), isNull(drivers.vacationUntil), notInArray(drivers.id, open), or(isNotNull(drivers.vehicleId), isNotNull(drivers.coVehicleId))))
    .limit(2000);
  if (!candidates.length) return 0;
  const hubs = await loadHubs(db, { now });
  // Real towns with a name in the game's language (no districts of a big city).
  const named = new Map((await db.select({ id: cities.id, name: cities.nameBg }).from(cities).where(and(inArray(cities.id, hubs.map((h) => h.id)), gte(cities.population, WISHES.minPopulation)))).filter((c) => /[а-яА-Я]/.test(c.name)).map((c) => [c.id, c.name]));
  let made = 0;
  for (const d of candidates) {
    if (rand() >= WISHES.dailyChance) continue;
    const truck = await truckOf(db, d.id);
    const here = truck ? hubs.find((h) => h.id === truck.cityId) ?? (await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon, countryCode: cities.countryCode }).from(cities).where(eq(cities.id, truck.cityId)))[0] : null;
    if (!truck || !here) continue;
    const near = hubs
      .filter((h) => h.id !== here.id && named.has(h.id) && (crossBorder(truck.licences) || h.countryCode === here.countryCode) && haversineKm([here.lat, here.lon], [h.lat, h.lon]) <= WISHES.maxKm)
      .sort((a, b) => b.population - a.population)
      .slice(0, 25);
    const city = near[Math.floor(rand() * near.length)];
    if (!city) continue;
    const reason = WISH_REASONS[Math.floor(rand() * WISH_REASONS.length)]!;
    const until = new Date(now.getTime() + WISHES.days * 86_400_000);
    await db
      .insert(driverWishes)
      .values({ driverId: d.id, companyId: d.companyId, cityId: city.id, reason, until, status: 'open', createdAt: now })
      .onConflictDoUpdate({ target: driverWishes.driverId, set: { cityId: city.id, reason, until, status: 'open', createdAt: now } });
    const load = await ensureWishLoad(db, { driverId: d.id, companyId: d.companyId, cityId: city.id, until }, now).catch(() => null);
    const name = named.get(city.id) ?? '';
    await notify(
      db, d.ownerId, 'info',
      () => t('🙏 {0} има молба', d.name),
      () => (load ? t('Иска курс до {0} за {1} — до 3 дни. Курсът те чака в Курсове, запазен за теб.', tx(name), tx(reason)) : t('Иска курс до {0} за {1} — до 3 дни.', tx(name), tx(reason))),
      load ? `/game/contracts?load=${load}` : '/game/staff',
    );
    made++;
  }
  return made;
}

export async function wishesOf(db: DbOrTx, companyId: string, now = new Date()) {
  return db
    .select({
      driverId: driverWishes.driverId, cityId: driverWishes.cityId, city: cities.nameBg, reason: driverWishes.reason, until: driverWishes.until, status: driverWishes.status,
      // The load held for the wish (the newest one still on the board).
      loadId: sql<string | null>`(select c.id from contracts c where c.dest_city_id = ${driverWishes.cityId} and c.reserved_by_company_id = ${companyId} and c.status = 'open' and c.reserved_until > ${now} and c.expires_at > ${now} order by c.created_at desc limit 1)`,
    })
    .from(driverWishes)
    .innerJoin(cities, eq(cities.id, driverWishes.cityId))
    .where(eq(driverWishes.companyId, companyId));
}

/** After a delivery: a driver of the trip whose wish was this city. */
export async function recordWishDelivery(tx: Tx, userId: string, crew: readonly string[], destCityId: number, now: Date) {
  if (!crew.length) return 0;
  const kept = await tx
    .update(driverWishes)
    .set({ status: 'done' })
    .where(and(inArray(driverWishes.driverId, [...crew]), eq(driverWishes.status, 'open'), eq(driverWishes.cityId, destCityId)))
    .returning({ driverId: driverWishes.driverId });
  for (const k of kept) {
    const [d] = await tx
      .update(drivers)
      .set({ loyalty: sql`least(100, ${drivers.loyalty} + ${WISHES.loyaltyKept})`, xp: sql`${drivers.xp} + ${WISHES.xpKept}` })
      .where(eq(drivers.id, k.driverId))
      .returning({ name: drivers.name });
    await notify(tx, userId, 'success', () => t('😊 {0} благодари', d?.name ?? ''), () => t('Желанието е изпълнено: +{0} лоялност и опит.', WISHES.loyaltyKept), '/game/staff');
  }
  void now;
  return kept.length;
}

/** Worker: wishes past their date are missed — loyalty drops. */
export async function expireWishes(db: Database, now = new Date()) {
  const missed = await db.update(driverWishes).set({ status: 'missed', missed: sql`${driverWishes.missed} + 1` }).where(and(eq(driverWishes.status, 'open'), lte(driverWishes.until, now))).returning({ driverId: driverWishes.driverId, companyId: driverWishes.companyId });
  for (const m of missed) {
    const [d] = await db.update(drivers).set({ loyalty: sql`greatest(0, ${drivers.loyalty} + ${WISHES.loyaltyMissed})` }).where(eq(drivers.id, m.driverId)).returning({ name: drivers.name });
    const [c] = await db.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, m.companyId));
    if (c && d) await notify(db, c.ownerId, 'warning', () => t('😞 {0} е разочарован', d.name), () => t('Молбата му не беше изпълнена: {0} лоялност.', WISHES.loyaltyMissed), '/game/staff');
  }
  return missed.length;
}
