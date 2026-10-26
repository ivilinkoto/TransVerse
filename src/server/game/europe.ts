import { and, count, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { BADGES } from '@/lib/game/halloween';
import { CABOTAGE, TRANS_EUROPE } from '@/lib/game/europe';
import { CARGO_TYPES, type CargoType } from '@/lib/game/cargo';
import { islandOf } from '@/lib/game/crossings';
import { featureLive } from '@/lib/game/features';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, userBadges } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import type { RoutingProvider } from '@/server/geo/routing';
import { addLoad, loadHubs } from './contracts';
import { fail } from './errors';
import { notify } from './notify';
import { pick, pickWeighted, rand } from './random';
import { t } from '@/i18n/t';

/** Worker: keeps a few trans-European loads (2 500 km and more) on the board. */
export async function ensureTransEuropeLoads(db: Database, now = new Date(), provider?: RoutingProvider) {
  if (!featureLive('trans_europe', now)) return 0;
  const [{ open = 0 } = {}] = await db.select({ open: count() }).from(contracts).where(and(eq(contracts.transEurope, true), eq(contracts.status, 'open'), gt(contracts.expiresAt, now)));
  const hubs = (await loadHubs(db, { now })).filter((h) => h.population >= 200_000 && !islandOf(h));
  let made = 0;
  for (let attempt = 0; attempt < 30 && open + made < TRANS_EUROPE.open; attempt++) {
    const origin = pickWeighted(hubs.filter((h) => h.produces.size), (h) => Math.sqrt(h.population));
    if (!origin) break;
    const far = hubs.filter((h) => haversineKm([origin.lat, origin.lon], [h.lat, h.lon]) * 1.25 >= TRANS_EUROPE.minKm);
    const destination = pick(far);
    if (!destination) continue;
    const cargo = ([...origin.produces].filter((c) => destination.consumes.has(c) && (CARGO_TYPES as readonly CargoType[]).includes(c)) as CargoType[])[0] ?? 'pallets';
    const tons = Math.round((TRANS_EUROPE.tons[0] + rand() * (TRANS_EUROPE.tons[1] - TRANS_EUROPE.tons[0])) * 10) / 10;
    if (await addLoad(db, origin.id, destination.id, cargo, tons, now, TRANS_EUROPE.ttlHours * 3_600_000, TRANS_EUROPE.multiplier, { transEurope: true }, provider, hubs)) made++;
  }
  return made;
}

/** A trans-European load needs a two-driver crew. */
export function requireTeam(contract: { transEurope: boolean }, coDriverId: string | null | undefined) {
  if (contract.transEurope && !coDriverId) fail('needs_team', t('Трансевропейски курс — само с двоен екипаж (втори шофьор в камиона).'));
}

/** The first trans-European load on time earns the badge. */
export async function transEuropeDone(tx: Tx, userId: string, contract: { transEurope: boolean }, late: boolean, at: Date) {
  if (!contract.transEurope || late || !(await featureFor(tx, userId, 'trans_europe', at))) return;
  const [got] = await tx.insert(userBadges).values({ userId, badge: TRANS_EUROPE.badge, awardedAt: at }).onConflictDoNothing().returning();
  if (got) await notify(tx, userId, 'achievement', () => t('Значка: {0}', BADGES[TRANS_EUROPE.badge]?.label ?? ''), () => t('Първият ти трансевропейски курс навреме.'), '/game/progress');
}

/**
 * Cabotage: in a country that is not the company's home, at most three
 * domestic loads within seven days (counted from the start of each trip).
 */
export async function cabotageUsed(db: DbOrTx, companyId: string, country: string, now: Date) {
  const since = new Date(now.getTime() - CABOTAGE.days * 86_400_000);
  const [row] = await db
    .select({ n: count() })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(and(
      eq(deliveries.companyId, companyId),
      gte(deliveries.startedAt, since),
      sql`(select country_code from cities where id = ${contracts.originCityId}) = ${country}`,
      sql`(select country_code from cities where id = ${contracts.destCityId}) = ${country}`,
    ));
  return row?.n ?? 0;
}

export async function checkCabotage(db: DbOrTx, userId: string, companyId: string, contract: { originCityId: number; destCityId: number }, now: Date) {
  if (!(await featureFor(db, userId, 'cabotage', now))) return;
  const ends = await db.select({ id: cities.id, country: cities.countryCode }).from(cities).where(inArray(cities.id, [contract.originCityId, contract.destCityId]));
  const o = ends.find((c) => c.id === contract.originCityId)?.country;
  const d = ends.find((c) => c.id === contract.destCityId)?.country;
  if (!o || o !== d) return;
  const [home] = await db.select({ country: cities.countryCode }).from(companies).innerJoin(cities, eq(cities.id, companies.hqCityId)).where(eq(companies.id, companyId));
  if (!home || home.country === o) return;
  const used = await cabotageUsed(db, companyId, o, now);
  if (used >= CABOTAGE.maxLoads) fail('cabotage', t('Каботаж: в чужда държава се карат най-много {0} вътрешни курса за {1} дни. Вземи международен товар.', CABOTAGE.maxLoads, CABOTAGE.days));
}
