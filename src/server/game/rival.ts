import { and, eq, gte, inArray, isNull, like, ne, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, deliveries, jobState, users } from '@/server/db/schema';
import { featureLive } from '@/lib/game/features';
import { weekKey } from '@/lib/game/leagues';
import { t } from '@/i18n/t';
import { notify } from './notify';

/**
 * 1.1.4.1 „Съперник“: every week the game picks a player of about the same
 * level who also plays, and keeps the score in trips. Overtake or get
 * overtaken — a notification says so (once per change).
 */
const pairKey = (week: string, userId: string) => `rival:${week}:${userId}`;
const stateKey = (week: string, userId: string) => `rival-state:${week}:${userId}`;
const weekStart = (week: string) => new Date(`${week.slice(1)}T00:00:00+02:00`);
export const RIVAL_LEVEL_GAP = 2;

async function pickRival(db: DbOrTx, userId: string, now: Date): Promise<string | null> {
  const [me] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  if (!me) return null;
  const candidates = await db
    .select({ id: users.id })
    .from(users)
    .where(and(ne(users.id, userId), isNull(users.bannedAt), gte(users.lastSeenAt, new Date(now.getTime() - 7 * 86_400_000)), sql`abs(${users.level} - ${me.level}) <= ${RIVAL_LEVEL_GAP}`, eq(users.role, 'player')))
    .orderBy(sql`abs(${users.level} - ${me.level})`, sql`md5(${users.id}::text || ${weekKey(now)})`)
    .limit(1);
  return candidates[0]?.id ?? null;
}

/** This week's rival (picked once and kept), or null when nobody fits. */
export async function rivalOf(db: DbOrTx, userId: string, now = new Date()) {
  const week = weekKey(now);
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, pairKey(week, userId)));
  let rivalId = (row?.value as { rivalId?: string | null } | undefined)?.rivalId;
  if (rivalId === undefined) {
    rivalId = await pickRival(db, userId, now);
    await db.insert(jobState).values({ key: pairKey(week, userId), value: { rivalId } }).onConflictDoNothing();
  }
  return rivalId ? { week, rivalId } : null;
}

async function tripsSince(db: DbOrTx, userIds: string[], since: Date) {
  const rows = await db
    .select({ userId: companies.ownerId, n: sql<number>`count(*)::int` })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .where(and(inArray(companies.ownerId, userIds), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, since)))
    .groupBy(companies.ownerId);
  return new Map(rows.map((r) => [r.userId, r.n]));
}

/** The score of the week: my trips against the rival's. */
export async function rivalStanding(db: DbOrTx, userId: string, now = new Date()) {
  const pair = await rivalOf(db, userId, now);
  if (!pair) return null;
  const [rival] = await db.select({ id: users.id, username: users.username, level: users.level }).from(users).where(eq(users.id, pair.rivalId));
  if (!rival) return null;
  const trips = await tripsSince(db, [userId, rival.id], weekStart(pair.week));
  return { rival, mine: trips.get(userId) ?? 0, theirs: trips.get(rival.id) ?? 0 };
}

/** Worker (hourly): a notification when the lead changes hands. */
export async function rivalAlerts(db: Database, now = new Date()) {
  if (!featureLive('rival', now)) return 0;
  const week = weekKey(now);
  const pairs = await db.select({ key: jobState.key, value: jobState.value }).from(jobState).where(like(jobState.key, `rival:${week}:%`));
  let sent = 0;
  for (const p of pairs) {
    const userId = p.key.slice(`rival:${week}:`.length);
    const rivalId = (p.value as { rivalId?: string | null }).rivalId;
    if (!rivalId) continue;
    const trips = await tripsSince(db, [userId, rivalId], weekStart(week));
    const mine = trips.get(userId) ?? 0;
    const theirs = trips.get(rivalId) ?? 0;
    const state = theirs > mine ? 'behind' : mine > theirs ? 'ahead' : 'tied';
    const [prev] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, stateKey(week, userId)));
    const before = (prev?.value as { state?: string } | undefined)?.state ?? 'tied';
    if (state === before) continue;
    await db.insert(jobState).values({ key: stateKey(week, userId), value: { state } }).onConflictDoUpdate({ target: jobState.key, set: { value: { state }, updatedAt: now } });
    if (state === 'tied') continue;
    const [rival] = await db.select({ username: users.username }).from(users).where(eq(users.id, rivalId));
    if (state === 'behind') await notify(db, userId, 'info', () => t('{0} те изпревари', rival?.username ?? '?'), () => t('Съперникът ти за седмицата: {0} курса срещу твоите {1}.', theirs, mine), '/game');
    else await notify(db, userId, 'success', () => t('Водиш срещу {0}!', rival?.username ?? '?'), () => t('{0} курса срещу {1} — дръж темпото.', mine, theirs), '/game');
    sent++;
  }
  return sent;
}
