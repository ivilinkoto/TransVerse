import { and, desc, eq, gt, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
import { MISSION_PERIODS, metricIncrement, missionById, periodWindow, pickMissions, scaledReward, scaledTarget, type DeliveryFacts, type MissionPeriod } from '@/lib/game/missions';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companyMembers, missionProgress, userLicences, users } from '@/server/db/schema';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';
import { awardXp } from './progression';
import { activeSeason } from './seasons';

export interface MissionWindow {
  period: MissionPeriod;
  key: string;
  endsAt: Date;
}

/** The current window of every mission period (Bulgarian time; seasons from the seasons table). */
export async function currentWindows(db: DbOrTx, now: Date): Promise<MissionWindow[]> {
  const season = await activeSeason(db, now);
  return MISSION_PERIODS.map((period) =>
    period === 'season' ? { period, key: `S${season.id}`, endsAt: season.endsAt } : { period, ...periodWindow(period, now) },
  );
}

/** Gives the player their missions for every current period they do not have yet. */
export async function ensureMissions(db: DbOrTx, userId: string, now: Date): Promise<MissionWindow[]> {
  const windows = await currentWindows(db, now);
  const have = await db
    .selectDistinct({ key: missionProgress.periodKey })
    .from(missionProgress)
    .where(and(eq(missionProgress.userId, userId), inArray(missionProgress.periodKey, windows.map((w) => w.key))));
  const missing = windows.filter((w) => !have.some((h) => h.key === w.key));
  if (!missing.length) return windows;

  const [user] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  const licences = new Set((await db.select({ l: userLicences.licence }).from(userLicences).where(eq(userLicences.userId, userId))).map((r) => r.l));
  const [member] = await db.select({ id: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.userId, userId));
  const profile = { level: user?.level ?? 1, licences, inCompany: !!member };
  for (const w of missing) {
    const picked = pickMissions(w.period, profile, `${userId}:${w.key}`);
    if (!picked.length) continue;
    await db
      .insert(missionProgress)
      .values(
        picked.map((m) => {
          const reward = scaledReward(m, profile.level);
          return { userId, periodKey: w.key, missionId: m.id, period: w.period, target: scaledTarget(m, profile.level), rewardCents: reward.cents, rewardXp: reward.xp, endsAt: w.endsAt };
        }),
      )
      .onConflictDoNothing();
  }
  return windows;
}

/** Adds a finished delivery to the player's current missions (inside the settlement transaction). */
export async function recordMissionProgress(tx: Tx, userId: string, facts: DeliveryFacts, now: Date) {
  const windows = await ensureMissions(tx, userId, now);
  const rows = await tx
    .select()
    .from(missionProgress)
    .where(and(eq(missionProgress.userId, userId), inArray(missionProgress.periodKey, windows.map((w) => w.key)), isNull(missionProgress.completedAt)))
    .for('update');
  for (const row of rows) {
    const def = missionById(row.missionId);
    if (!def) continue;
    let progress = row.progress;
    let data = row.data;
    if (def.metric === 'countries') {
      const seen = new Set([...(row.data.countries ?? []), ...facts.countries]);
      data = { ...row.data, countries: [...seen].sort() };
      progress = seen.size;
    } else {
      const inc = metricIncrement(def.metric, facts);
      if (!inc) continue;
      progress = row.progress + inc;
    }
    const done = progress >= row.target;
    await tx
      .update(missionProgress)
      .set({ progress: Math.min(progress, row.target), data, completedAt: done ? now : null })
      .where(and(eq(missionProgress.userId, userId), eq(missionProgress.periodKey, row.periodKey), eq(missionProgress.missionId, row.missionId)));
    if (done) await notify(tx, userId, 'achievement', `Мисията е изпълнена: ${def.title(row.target)}`, 'Вземи наградата от раздел „Мисии“.', '/game/missions');
  }
}

/** Pays a completed mission's reward exactly once. */
export async function claimMission(db: Database, userId: string, periodKey: string, missionId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(missionProgress)
      .where(and(eq(missionProgress.userId, userId), eq(missionProgress.periodKey, periodKey), eq(missionProgress.missionId, missionId)))
      .for('update');
    if (!row) fail('mission_not_found', 'Мисията не е намерена.', 404);
    if (!row!.completedAt) fail('mission_incomplete', 'Мисията още не е изпълнена.');
    if (row!.claimedAt) fail('mission_claimed', 'Наградата вече е взета.', 409);
    const def = missionById(row!.missionId);
    const account = await companyForUser(tx, userId);
    await post(tx, account.id, [{ category: 'mission_reward', amountCents: row!.rewardCents, description: `Мисия: ${def ? def.title(row!.target) : row!.missionId}`, idempotencyKey: `mission:${userId}:${periodKey}:${missionId}` }]);
    await awardXp(tx, userId, row!.rewardXp);
    await tx
      .update(missionProgress)
      .set({ claimedAt: new Date() })
      .where(and(eq(missionProgress.userId, userId), eq(missionProgress.periodKey, periodKey), eq(missionProgress.missionId, missionId)));
    return { cents: row!.rewardCents, xp: row!.rewardXp };
  });
}

/** Everything the missions page shows: current missions plus completed, unclaimed ones from earlier periods. */
export async function missionBoard(db: DbOrTx, userId: string, now: Date) {
  // Inserts are idempotent (ON CONFLICT DO NOTHING), so no transaction is needed here.
  const windows = await ensureMissions(db, userId, now);
  const keys = windows.map((w) => w.key);
  const [current, unclaimed] = await Promise.all([
    db.select().from(missionProgress).where(and(eq(missionProgress.userId, userId), inArray(missionProgress.periodKey, keys))),
    db
      .select()
      .from(missionProgress)
      .where(and(eq(missionProgress.userId, userId), isNotNull(missionProgress.completedAt), isNull(missionProgress.claimedAt), notInArray(missionProgress.periodKey, keys), gt(missionProgress.endsAt, new Date(now.getTime() - 30 * 86_400_000))))
      .orderBy(desc(missionProgress.endsAt)),
  ]);
  return { windows, current, unclaimed };
}

/** Completed missions waiting to be claimed (badge in the menu). */
export async function claimableCount(db: DbOrTx, userId: string): Promise<number> {
  const [{ n = 0 } = {}] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(missionProgress)
    .where(and(eq(missionProgress.userId, userId), isNotNull(missionProgress.completedAt), isNull(missionProgress.claimedAt)));
  return n;
}
