import { and, eq, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, driverWishes, drivers } from '@/server/db/schema';
import { featureLive } from '@/lib/game/features';
import { WISHES, WISH_REASONS } from '@/lib/game/wishes';
import { haversineKm } from '@/lib/geo/geometry';
import { t } from '@/i18n/t';
import { loadHubs } from './contracts';
import { notify } from './notify';

/**
 * 1.1.4.2 „Желанията на шофьорите“: once a day some hired drivers ask for a
 * trip to a city near the company's base, within three days.
 */
export async function spawnWishes(db: Database, now = new Date(), rand: () => number = Math.random) {
  if (!featureLive('driver_wishes', now)) return 0;
  const open = db.select({ id: driverWishes.driverId }).from(driverWishes).where(eq(driverWishes.status, 'open'));
  const candidates = await db
    .select({ id: drivers.id, name: drivers.name, companyId: drivers.companyId, ownerId: companies.ownerId, hq: companies.hqCityId })
    .from(drivers)
    .innerJoin(companies, eq(companies.id, drivers.companyId))
    .where(and(eq(drivers.isOwner, false), isNull(drivers.vacationUntil), notInArray(drivers.id, open)))
    .limit(2000);
  if (!candidates.length) return 0;
  const hubs = await loadHubs(db, { now });
  const bases = await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, [...new Set(candidates.map((c) => c.hq))]));
  let made = 0;
  for (const d of candidates) {
    if (rand() >= WISHES.dailyChance) continue;
    const base = bases.find((b) => b.id === d.hq);
    if (!base) continue;
    const near = hubs.filter((h) => h.id !== base.id && haversineKm([base.lat, base.lon], [h.lat, h.lon]) <= WISHES.maxKm).sort((a, b) => b.population - a.population).slice(0, 25);
    const city = near[Math.floor(rand() * near.length)];
    if (!city) continue;
    const reason = WISH_REASONS[Math.floor(rand() * WISH_REASONS.length)]!;
    const until = new Date(now.getTime() + WISHES.days * 86_400_000);
    await db
      .insert(driverWishes)
      .values({ driverId: d.id, companyId: d.companyId, cityId: city.id, reason, until, status: 'open', createdAt: now })
      .onConflictDoUpdate({ target: driverWishes.driverId, set: { cityId: city.id, reason, until, status: 'open', createdAt: now } });
    const [c] = await db.select({ nameBg: cities.nameBg }).from(cities).where(eq(cities.id, city.id));
    await notify(db, d.ownerId, 'info', () => t('🙏 {0} има молба', d.name), () => t('Иска курс до {0} за {1} — до 3 дни.', c?.nameBg ?? '', reason), '/game/staff');
    made++;
  }
  return made;
}

export async function wishesOf(db: DbOrTx, companyId: string) {
  return db
    .select({ driverId: driverWishes.driverId, cityId: driverWishes.cityId, city: cities.nameBg, reason: driverWishes.reason, until: driverWishes.until, status: driverWishes.status })
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
