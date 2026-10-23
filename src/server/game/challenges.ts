import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { BADGES } from '@/lib/game/halloween';
import { BIG_CONVOY, bigConvoyShare, CHALLENGE_METRICS, challengeMetric, EUROTOUR, WEEKLY_CHALLENGE, type ChallengeMetric } from '@/lib/game/challenges';
import { CONVOY_RULES } from '@/lib/game/convoy';
import { featureLive } from '@/lib/game/features';
import { periodWindow, sofiaMidnight, sofiaParts } from '@/lib/game/missions';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, countries, deliveries, jobState, openConvoys, userBadges, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { post } from './finance';
import { notify } from './notify';

const monthStart = (at: Date) => {
  const { y, m } = sofiaParts(at);
  return sofiaMidnight(y, m, 1);
};

/** The countries the player delivered to this month (Sofia), with their names. */
export async function eurotourProgress(db: DbOrTx, userId: string, now: Date) {
  const rows = await db
    .selectDistinct({ code: cities.countryCode })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, monthStart(now)), lt(deliveries.completedAt, periodWindow('monthly', now).endsAt)));
  const names = await db.select({ code: countries.code, nameBg: countries.nameBg }).from(countries).where(inArray(countries.code, [...EUROTOUR.countries]));
  const done = new Set(rows.map((r) => r.code));
  return EUROTOUR.countries.map((code) => ({ code, name: names.find((n) => n.code === code)?.nameBg ?? code, done: done.has(code) }));
}

/** A delivery arrived: with it the player may have reached all nine countries this month (once a month). */
export async function checkEurotour(tx: Tx, userId: string, destCountry: string, at: Date) {
  if (!EUROTOUR.countries.includes(destCountry) || !(await featureFor(tx, userId, 'eurotour', at))) return false;
  // This delivery is not marked completed yet: its country counts too.
  const done = new Set((await eurotourProgress(tx, userId, at)).filter((c) => c.done).map((c) => c.code)).add(destCountry);
  if (!EUROTOUR.countries.every((c) => done.has(c))) return false;
  const month = periodWindow('monthly', at).key;
  const [first] = await tx.insert(jobState).values({ key: `eurotour:${userId}:${month}`, value: { at: at.toISOString() } }).onConflictDoNothing().returning();
  if (!first) return false;
  await tx.insert(userBadges).values({ userId, badge: EUROTOUR.badge, awardedAt: at }).onConflictDoNothing();
  await postCoins(tx, userId, { amount: EUROTOUR.coins, reason: 'challenge', description: `Евротур ${month.slice(1)}`, idempotencyKey: `eurotour:${userId}:${month}` });
  await notify(tx, userId, 'achievement', 'Евротур! 🇪🇺', `Доставки до всичките ${EUROTOUR.countries.length} държави този месец — значка „${BADGES[EUROTOUR.badge]?.label ?? ''}“ и ${EUROTOUR.coins} TC.`, '/game/challenges');
  return true;
}

// ── The big convoy ───────────────────────────────────────────────────────

export async function convoySize(db: DbOrTx, leadId: string) {
  const [row] = await db.select({ n: count() }).from(deliveries).where(eq(deliveries.convoyLead, leadId));
  return row?.n ?? 0;
}

/**
 * A big convoy on arrival: from three trucks on, each one on time gets an
 * extra share (personal account, before any treasury); the first truck's
 * driver earns the badge "Водач на колона".
 */
export async function bigConvoyBonus(tx: Tx, userId: string, d: { id: string; companyId: string; convoyLead: string | null }, f: { late: boolean; rewardCents: number }, at: Date) {
  if (!d.convoyLead || f.late || !(await featureFor(tx, userId, 'big_convoy', at))) return 0;
  const size = await convoySize(tx, d.convoyLead);
  const bonus = Math.round(f.rewardCents * bigConvoyShare(size));
  if (!bonus) return 0;
  await post(tx, d.companyId, [{ category: 'convoy_bonus', amountCents: bonus, description: `Голям конвой (${size} камиона)`, idempotencyKey: `delivery:${d.id}:big-convoy`, refType: 'delivery', refId: d.id }]);
  if (d.id === d.convoyLead) {
    const [got] = await tx.insert(userBadges).values({ userId, badge: BIG_CONVOY.badge, awardedAt: at }).onConflictDoNothing().returning();
    if (got) await notify(tx, userId, 'achievement', `Значка: ${BADGES[BIG_CONVOY.badge]?.label ?? ''}`, `Поведе колона от ${size} камиона и пристигна навреме.`, '/game/challenges');
  }
  return bonus;
}

/** Announced convoys (/конвой) still open, with their size — anyone may join them. */
export async function openBigConvoys(db: DbOrTx, now: Date, limit = 10) {
  const o = sql<string>`(select name_bg from cities where id = ${openConvoys.originCityId})`;
  const t = sql<string>`(select name_bg from cities where id = ${openConvoys.destCityId})`;
  const size = sql<number>`(select count(*)::int from deliveries x where x.convoy_lead = ${deliveries.convoyLead})`;
  const rows = await db
    .select({ id: openConvoys.id, from: o, to: t, username: users.username, expiresAt: openConvoys.expiresAt, lead: deliveries.convoyLead, size })
    .from(openConvoys)
    .innerJoin(users, eq(users.id, openConvoys.userId))
    .innerJoin(deliveries, eq(deliveries.id, openConvoys.deliveryId))
    .where(and(gt(openConvoys.expiresAt, now), eq(deliveries.status, 'in_progress')))
    .orderBy(asc(openConvoys.expiresAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, size: r.lead ? r.size : 1 })).filter((r) => r.size < BIG_CONVOY.maxTrucks);
}

// ── The challenge of the week ────────────────────────────────────────────

/** The week's window (Monday 00:00 Sofia to the next Monday). */
export function challengeWeek(now: Date) {
  const w = periodWindow('weekly', now);
  const startsAt = periodWindow('weekly', new Date(w.endsAt.getTime() - 8 * 86_400_000)).endsAt;
  return { key: w.key, startsAt, endsAt: w.endsAt, metric: challengeMetric(w.key) };
}

const metricValue: Record<ChallengeMetric, ReturnType<typeof sql<number>>> = {
  ontime: sql<number>`count(*)::float`,
  km: sql<number>`round(coalesce(sum(${deliveries.loadedKm}), 0))::float`,
  tons: sql<number>`round(coalesce(sum(${contracts.weightTons}), 0)::numeric, 1)::float`,
  countries: sql<number>`count(distinct ${cities.countryCode})::float`,
  lanes: sql<number>`count(distinct (${contracts.originCityId}, ${contracts.destCityId}))::float`,
};

/** The ranking of a week: on-time trips that arrived in it count. */
export async function challengeRanking(db: DbOrTx, week: { startsAt: Date; endsAt: Date; metric: ChallengeMetric }) {
  const value = metricValue[week.metric];
  return db
    .select({ userId: users.id, username: users.username, value })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(cities, eq(cities.id, contracts.destCityId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(and(eq(deliveries.status, 'completed'), eq(deliveries.late, false), gte(deliveries.completedAt, week.startsAt), lt(deliveries.completedAt, week.endsAt), isNull(users.bannedAt)))
    .groupBy(users.id, users.username)
    .orderBy(desc(value), asc(users.username));
}

/** This week's challenge: the measure, the top and the player's place. */
export async function weeklyChallenge(db: DbOrTx, now: Date, userId?: string | null, top = 10) {
  const week = challengeWeek(now);
  const rows = await challengeRanking(db, week);
  const at = userId ? rows.findIndex((r) => r.userId === userId) : -1;
  return { ...week, ...CHALLENGE_METRICS[week.metric], top: rows.slice(0, top), players: rows.length, mine: at >= 0 ? { place: at + 1, value: rows[at]!.value } : null };
}

/** Worker: some hours after a week ends (trips still on the road settle first), its top three get ТрансКоин. */
export async function settleWeeklyChallenge(db: Database, now: Date) {
  if (!featureLive('weekly_challenge', now)) return null;
  const current = challengeWeek(now);
  if (now.getTime() - current.startsAt.getTime() < WEEKLY_CHALLENGE.graceMs) return null;
  const last = challengeWeek(new Date(current.startsAt.getTime() - 3_600_000));
  const rows = (await challengeRanking(db, last)).filter((r) => r.value > 0).slice(0, WEEKLY_CHALLENGE.prizes.length);
  return db.transaction(async (tx) => {
    const [first] = await tx.insert(jobState).values({ key: `weekly-challenge:${last.key}`, value: { winners: rows.map((r) => r.userId) } }).onConflictDoNothing().returning();
    if (!first) return null;
    const m = CHALLENGE_METRICS[last.metric];
    for (const [i, r] of rows.entries()) {
      const coins = WEEKLY_CHALLENGE.prizes[i]!;
      await postCoins(tx, r.userId, { amount: coins, reason: 'challenge', description: `Предизвикателство ${last.key}: ${m.title}, ${i + 1}. място`, idempotencyKey: `weekly-challenge:${last.key}:${r.userId}` });
      await notify(tx, r.userId, 'achievement', `Предизвикателство на седмицата: ${i + 1}. място! 🏆`, `„${m.title}“ — ${r.value} ${m.unit}. Награда: ${coins} TC.`, '/game/challenges');
    }
    return { week: last.key, winners: rows.length };
  });
}

/** How far in time a convoy can still grow (for the page). */
export const CONVOY_WINDOW_MIN = Math.round(CONVOY_RULES.windowMs / 60_000);
