/**
 * 1.2.3 „Договор на седмицата“: the lane of the week (stored in job_state),
 * the loads kept open on it, and the first players who deliver one on time.
 */
import { and, eq, like, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { isoWeek } from '@/lib/game/shop-v2';
import { isWeeklyLaneTag, WEEKLY_LANE, weeklyLaneTag } from '@/lib/game/weekly-lane';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, contracts, jobState, userBadges } from '@/server/db/schema';
import type { RoutingProvider } from '@/server/geo/routing';
import { postCoins } from './coins';
import { insertTaggedLoad, loadHubs } from './contracts';
import { notify } from './notify';
import { pick, pickWeighted, rand } from './random';
import { t } from '@/i18n/t';

interface Lane { originId: number; destId: number }
const laneKey = (week: string) => `weekly-lane:${week}`;

/** The lane of this week, chosen once (big cities of the open countries, 300–900 km apart). */
export async function weeklyLane(db: DbOrTx, now: Date): Promise<(Lane & { week: string }) | null> {
  const week = isoWeek(now);
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, laneKey(week)));
  if (row) return { ...(row.value as Lane), week };
  const hubs = (await loadHubs(db, { now })).filter((h) => h.population >= 150_000 && h.produces.has(WEEKLY_LANE.cargo));
  for (let i = 0; i < 30; i++) {
    const origin = pickWeighted(hubs, (h) => Math.sqrt(h.population));
    if (!origin) return null;
    const dest = pickWeighted(hubs.filter((h) => h.id !== origin.id && h.consumes.has(WEEKLY_LANE.cargo)), (h) => {
      const km = haversineKm([origin.lat, origin.lon], [h.lat, h.lon]) * 1.25;
      return km < WEEKLY_LANE.minKm || km > WEEKLY_LANE.maxKm ? 0 : Math.sqrt(h.population);
    });
    if (!dest) continue;
    const lane: Lane = { originId: origin.id, destId: dest.id };
    await db.insert(jobState).values({ key: laneKey(week), value: lane }).onConflictDoNothing();
    const [saved] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, laneKey(week)));
    return { ...(saved!.value as Lane), week };
  }
  return null;
}

/** Worker: keeps a few loads open on the lane of the week. */
export async function ensureWeeklyLaneLoads(db: Database, now = new Date(), provider?: RoutingProvider) {
  if (!featureLive('weekly_lane', now)) return 0;
  const lane = await weeklyLane(db, now);
  if (!lane) return 0;
  const tag = weeklyLaneTag(lane.week);
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(contracts).where(and(eq(contracts.tag, tag), eq(contracts.status, 'open'), sql`${contracts.expiresAt} > ${now}`));
  const hubs = await loadHubs(db, { now });
  const origin = hubs.find((h) => h.id === lane.originId), dest = hubs.find((h) => h.id === lane.destId);
  if (!origin || !dest) return 0;
  let made = 0;
  for (let i = n; i < WEEKLY_LANE.openLoads; i++) {
    const tons = Math.round((8 + rand() * 14) * 10) / 10;
    if (await insertTaggedLoad(db, origin, dest, WEEKLY_LANE.cargo, tons, now, WEEKLY_LANE.ttlHours * 3_600_000, WEEKLY_LANE.multiplier, [], { tag, goods: pick(WEEKLY_LANE.goods) }, provider)) made++;
  }
  return made;
}

/** A delivery arrived: one on the lane of the week, on time, puts the player among the winners (while places are left). */
export async function recordWeeklyLane(tx: Tx, f: { userId: string; tag: string | null; late: boolean }, at: Date) {
  if (!isWeeklyLaneTag(f.tag) || f.late) return false;
  const week = f.tag!.slice('weekly-lane:'.length);
  const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(jobState).where(like(jobState.key, `weekly-lane-win:${week}:%`));
  if (n >= WEEKLY_LANE.winners) return false;
  const [first] = await tx.insert(jobState).values({ key: `weekly-lane-win:${week}:${f.userId}`, value: { at: at.toISOString(), place: n + 1 } }).onConflictDoNothing().returning();
  if (!first) return false;
  await tx.insert(userBadges).values({ userId: f.userId, badge: WEEKLY_LANE.badge, awardedAt: at }).onConflictDoNothing();
  await postCoins(tx, f.userId, { amount: WEEKLY_LANE.coins, reason: 'challenge', description: t('Договор на седмицата · място {0}', n + 1), idempotencyKey: `weekly-lane-win:${week}:${f.userId}` });
  await notify(tx, f.userId, 'achievement', () => t('Договор на седмицата: място {0}!', n + 1), () => t('Значка „Договор на седмицата“ и {0} TC.', WEEKLY_LANE.coins), '/game/compete');
  return true;
}

/** For the pages: the lane, how many places are taken and whether the player has one. */
export async function weeklyLaneView(db: DbOrTx, userId: string, now: Date) {
  const lane = await weeklyLane(db, now);
  if (!lane) return null;
  const names = await db.select({ id: cities.id, name: cities.nameBg, country: cities.countryCode }).from(cities).where(sql`${cities.id} in (${lane.originId}, ${lane.destId})`);
  const of = (id: number) => names.find((c) => c.id === id);
  const winners = await db.select({ key: jobState.key }).from(jobState).where(like(jobState.key, `weekly-lane-win:${lane.week}:%`));
  return { ...lane, origin: of(lane.originId), dest: of(lane.destId), taken: winners.length, mine: winners.some((w) => w.key.endsWith(`:${userId}`)) };
}
