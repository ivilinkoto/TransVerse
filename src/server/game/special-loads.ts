import { and, count, eq, gt, inArray, lte } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { contracts, users } from '@/server/db/schema';
import { powerUnitModel } from '@/lib/game/catalog';
import { featureLive } from '@/lib/game/features';
import { sofiaHourOf } from '@/lib/game/together';
import { LAST_MILE, LIVESTOCK, NIGHT_COURIER, isNightCourierHour, type LoadTag } from '@/lib/game/special-loads';
import { haversineKm } from '@/lib/geo/geometry';
import type { RoutingProvider } from '@/server/geo/routing';
import { t } from '@/i18n/t';
import { featureFor } from '@/server/features';
import { insertTaggedLoad, loadHubs, type Hub } from './contracts';
import { fail } from './errors';
import { pick, rand } from './random';
import { onVacation } from './vacation';

const openOf = async (db: DbOrTx, tag: LoadTag, now: Date) =>
  (await db.select({ n: count() }).from(contracts).where(and(eq(contracts.tag, tag), eq(contracts.status, 'open'), gt(contracts.expiresAt, now))))[0]?.n ?? 0;

const km = (a: Hub, b: Hub) => haversineKm([a.lat, a.lon], [b.lat, b.lon]) * 1.25;
const between = (lo: number, hi: number) => Math.round((lo + rand() * (hi - lo)) * 10) / 10;

/** The next 06:00 Sofia time (when the night courier loads end). */
function nextMorning(now: Date) {
  for (let h = 1; h <= 24; h++) {
    const at = new Date(now.getTime() + h * 3_600_000);
    if (sofiaHourOf(at) === NIGHT_COURIER.to) return new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000);
  }
  return new Date(now.getTime() + 8 * 3_600_000);
}

/** Worker: night courier lines between big hubs, only at night. */
export async function ensureNightCouriers(db: Database, now = new Date(), provider?: RoutingProvider) {
  if (!featureLive('night_courier', now) || !isNightCourierHour(sofiaHourOf(now))) return 0;
  const missing = NIGHT_COURIER.open - (await openOf(db, 'night_courier', now));
  if (missing <= 0) return 0;
  const big = (await loadHubs(db, { now })).sort((a, b) => b.population - a.population).slice(0, 40);
  const ttl = Math.max(3_600_000, nextMorning(now).getTime() - now.getTime());
  let made = 0;
  for (let i = 0; i < missing * 4 && made < missing; i++) {
    const a = pick(big);
    const b = pick(big.filter((h) => h.id !== a.id && km(a, h) >= NIGHT_COURIER.minKm && km(a, h) <= NIGHT_COURIER.maxKm));
    if (!b) continue;
    if (await insertTaggedLoad(db, a, b, 'pallets', between(...NIGHT_COURIER.tons), now, ttl, NIGHT_COURIER.multiplier, [], { tag: 'night_courier', goods: pick(NIGHT_COURIER.goods) }, provider)) made++;
  }
  return made;
}

/** Worker: city deliveries with drops for vans. */
export async function ensureLastMile(db: Database, now = new Date(), provider?: RoutingProvider) {
  if (!featureLive('last_mile', now)) return 0;
  const missing = LAST_MILE.open - (await openOf(db, 'last_mile', now));
  if (missing <= 0) return 0;
  const hubs = await loadHubs(db, { now });
  const big = [...hubs].sort((a, b) => b.population - a.population).slice(0, 60);
  let made = 0;
  for (let i = 0; i < missing * 4 && made < missing; i++) {
    const origin = pick(big);
    const near = hubs.filter((h) => h.id !== origin.id && km(origin, h) <= LAST_MILE.maxKm / 2).sort((a, b) => km(origin, a) - km(origin, b));
    if (near.length < LAST_MILE.drops + 1) continue;
    const picks = [...near].sort(() => rand() - 0.5).slice(0, LAST_MILE.drops + 1).sort((a, b) => km(origin, a) - km(origin, b));
    const destination = picks.pop()!;
    if (await insertTaggedLoad(db, origin, destination, 'pallets', between(...LAST_MILE.tons), now, 6 * 3_600_000, LAST_MILE.multiplier, picks, { tag: 'last_mile', goods: pick(LAST_MILE.goods) }, provider)) made++;
  }
  return made;
}

/** Worker: livestock loads — from farming areas (grain producers) to cities that take food. */
export async function ensureLivestockLoads(db: Database, now = new Date(), provider?: RoutingProvider) {
  if (!featureLive('livestock', now)) return 0;
  const missing = LIVESTOCK.open - (await openOf(db, 'livestock', now));
  if (missing <= 0) return 0;
  const hubs = await loadHubs(db, { now });
  const farms = hubs.filter((h) => h.produces.has('bulk'));
  const buyers = hubs.filter((h) => h.consumes.has('refrigerated'));
  let made = 0;
  for (let i = 0; i < missing * 4 && made < missing; i++) {
    const a = pick(farms.length ? farms : hubs);
    const b = pick(buyers.filter((h) => h.id !== a.id && km(a, h) >= LIVESTOCK.minKm && km(a, h) <= LIVESTOCK.maxKm));
    if (!b) continue;
    if (await insertTaggedLoad(db, a, b, 'livestock', between(...LIVESTOCK.tons), now, 12 * 3_600_000, LIVESTOCK.multiplier, [], { tag: 'livestock', goods: pick(LIVESTOCK.goods) }, provider)) made++;
  }
  return made;
}

/** When a load is taken: its own rules, and none while the player is on vacation. */
export async function checkTripRules(db: DbOrTx, userId: string, contract: { tag: string | null }, modelId: string, now: Date) {
  const [u] = await db.select({ vacationUntil: users.vacationUntil }).from(users).where(eq(users.id, userId));
  if (onVacation(u?.vacationUntil, now)) fail('on_vacation', t('В отпуска си — камионите почиват. Прекрати отпуската от Настройки.'), 409);
  if (contract.tag === 'night_courier' && !isNightCourierHour(sofiaHourOf(now))) fail('night_only', t('Нощните куриерски товари се взимат от 20:00 до 06:00.'));
  if (contract.tag === 'last_mile' && powerUnitModel(modelId).kind !== 'van') fail('van_only', t('„Последна миля“ е само за ванове.'));
  if (contract.tag && !(await featureFor(db, userId, contract.tag as LoadTag, now))) fail('not_released', t('Това идва със следващото обновление.'), 403);
}

/** Expired special loads are left to the usual expiry; this just counts them for the admin. */
export async function specialLoadCounts(db: DbOrTx, now = new Date()) {
  const rows = await db.select({ tag: contracts.tag, n: count() }).from(contracts).where(and(inArray(contracts.tag, ['night_courier', 'last_mile', 'livestock']), eq(contracts.status, 'open'), gt(contracts.expiresAt, now), lte(contracts.createdAt, now))).groupBy(contracts.tag);
  return Object.fromEntries(rows.map((r) => [r.tag, r.n]));
}
