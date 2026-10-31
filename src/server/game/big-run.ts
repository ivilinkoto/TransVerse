import { and, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, jobState, userBadges } from '@/server/db/schema';
import { BIG_RUN, pickBigRun, type BigRunLeg } from '@/lib/game/big-run';
import { featureLive } from '@/lib/game/features';
import { weekKey } from '@/lib/game/leagues';
import { t } from '@/i18n/t';
import { postCoins } from './coins';
import { addLoad, loadHubs } from './contracts';
import { notify } from './notify';

/**
 * 1.1.4.1 „Голям рейс“: the week's three legs are picked once (kept in
 * job_state), so they stay the same for everyone even if the cities change.
 */
const key = (week: string) => `big-run:${week}`;
/** The Monday of the week key (WYYYY-MM-DD), a little before Sofia midnight — enough for counting. */
const weekStart = (week: string) => new Date(`${week.slice(1)}T00:00:00+02:00`);

export async function bigRunOf(db: DbOrTx, now = new Date()): Promise<{ week: string; legs: BigRunLeg[] }> {
  const week = weekKey(now);
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(week)));
  if (row) return { week, legs: (row.value as { legs: BigRunLeg[] }).legs };
  const hubs = await loadHubs(db, { now });
  const big = await db
    .select({ id: cities.id, nameBg: cities.nameBg, countryCode: cities.countryCode, lat: cities.lat, lon: cities.lon })
    .from(cities)
    .where(inArray(cities.id, hubs.map((h) => h.id)))
    .orderBy(desc(cities.population))
    .limit(60);
  const legs = pickBigRun(week, big);
  await db.insert(jobState).values({ key: key(week), value: { legs } }).onConflictDoNothing();
  return { week, legs };
}

/** Which of the week's legs this player drove (with a truck of their own company). */
export async function bigRunProgress(db: DbOrTx, userId: string, run: { week: string; legs: BigRunLeg[] }) {
  if (!run.legs.length) return [] as boolean[];
  const done = await db
    .selectDistinct({ from: contracts.originCityId, to: contracts.destCityId })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, weekStart(run.week))));
  return run.legs.map((l) => done.some((d) => d.from === l.from.id && d.to === l.to.id));
}

/** After a delivery: the last leg of the week brings the ТрансКоин (and the badge, the first time). */
export async function recordBigRunDelivery(tx: Tx, userId: string, originId: number, destId: number, completedAt: Date) {
  if (!featureLive('big_run', completedAt)) return false;
  const run = await bigRunOf(tx, completedAt);
  if (!run.legs.some((l) => l.from.id === originId && l.to.id === destId)) return false;
  const progress = await bigRunProgress(tx, userId, run);
  if (!progress.length || !progress.every(Boolean)) return false;
  const paid = await postCoins(tx, userId, { amount: BIG_RUN.coins, reason: 'big_run', description: t('Голям рейс {0}', run.week.slice(1)), idempotencyKey: `big-run:${run.week}:${userId}` });
  if (!paid) return false;
  await tx.insert(userBadges).values({ userId, badge: BIG_RUN.badge, awardedAt: completedAt }).onConflictDoNothing();
  await notify(tx, userId, 'achievement', () => t('🏁 Големият рейс е твой!'), () => t('Всички {0} етапа за седмицата — +{1} ТрансКоин.', BIG_RUN.legs, BIG_RUN.coins), '/game/big-run');
  return true;
}

/** Worker: each leg always has an open load on the board (better paid). */
export async function ensureBigRunLoads(db: Database, now = new Date()) {
  if (!featureLive('big_run', now)) return 0;
  const run = await bigRunOf(db, now);
  let made = 0;
  for (const leg of run.legs) {
    const [open] = await db
      .select({ id: contracts.id })
      .from(contracts)
      .where(and(eq(contracts.originCityId, leg.from.id), eq(contracts.destCityId, leg.to.id), eq(contracts.status, 'open'), gt(contracts.expiresAt, now), sql`${contracts.reservedByCompanyId} is null`))
      .limit(1);
    if (open) continue;
    if (await addLoad(db, leg.from.id, leg.to.id, 'pallets', 12, now, 12 * 3_600_000, BIG_RUN.multiplier, {})) made++;
  }
  return made;
}
