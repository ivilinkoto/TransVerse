import { and, eq, inArray, sql } from 'drizzle-orm';
import { companyIncrement, companyMissionById, companyMissionReward, companyMissionTarget, pickCompanyMissions } from '@/lib/game/company-missions';
import { periodWindow, type DeliveryFacts } from '@/lib/game/missions';
import type { DbOrTx, Tx } from '@/server/db/client';
import { companyMembers, companyMissionProgress, organizations, users } from '@/server/db/schema';
import { postTreasury } from './finance';
import { addCompanyXp, notifyMembers } from './membership';
import { t, intlLocale } from '@/i18n/t';

/** Gives the company its missions for the current week (sized by the members it has now). */
export async function ensureCompanyMissions(db: DbOrTx, companyId: string, now: Date) {
  const w = periodWindow('weekly', now);
  const [have] = await db.select({ n: sql<number>`count(*)::int` }).from(companyMissionProgress).where(and(eq(companyMissionProgress.companyId, companyId), eq(companyMissionProgress.periodKey, w.key)));
  if ((have?.n ?? 0) > 0) return w;
  const [org] = await db.select({ level: organizations.companyLevel }).from(organizations).where(eq(organizations.id, companyId));
  if (!org) return w;
  const [{ members = 1 } = {}] = await db.select({ members: sql<number>`count(*)::int` }).from(companyMembers).where(eq(companyMembers.companyId, companyId));
  const picked = pickCompanyMissions(`${companyId}:${w.key}`, members);
  await db
    .insert(companyMissionProgress)
    .values(
      picked.map((m) => {
        const reward = companyMissionReward(m, members, org.level);
        return { companyId, periodKey: w.key, missionId: m.id, target: companyMissionTarget(m, members), rewardCents: reward.cents, rewardXp: reward.xp, endsAt: w.endsAt };
      }),
    )
    .onConflictDoNothing();
  return w;
}

/**
 * Adds a member's finished delivery to the company's weekly missions (inside the
 * settlement transaction). A completed mission pays its reward into the treasury
 * and company XP straight away, exactly once.
 */
export async function recordCompanyMissionProgress(tx: Tx, companyId: string, userId: string, facts: DeliveryFacts, now: Date) {
  const w = await ensureCompanyMissions(tx, companyId, now);
  const rows = await tx
    .select()
    .from(companyMissionProgress)
    .where(and(eq(companyMissionProgress.companyId, companyId), eq(companyMissionProgress.periodKey, w.key), sql`${companyMissionProgress.completedAt} is null`))
    .for('update');
  for (const row of rows) {
    const def = companyMissionById(row.missionId);
    if (!def) continue;
    const members = { ...(row.data.members ?? {}) };
    let progress: number;
    if (def.metric === 'active_members') {
      members[userId] = (members[userId] ?? 0) + 1;
      progress = Object.keys(members).length;
    } else {
      const inc = companyIncrement(def.metric, facts);
      if (!inc) continue;
      members[userId] = (members[userId] ?? 0) + inc;
      progress = row.progress + inc;
    }
    const done = progress >= row.target;
    await tx
      .update(companyMissionProgress)
      .set({ progress: Math.min(progress, row.target), data: { members }, completedAt: done ? now : null })
      .where(and(eq(companyMissionProgress.companyId, companyId), eq(companyMissionProgress.periodKey, row.periodKey), eq(companyMissionProgress.missionId, row.missionId)));
    if (!done) continue;
    const title = def.title(row.target);
    await postTreasury(tx, companyId, [{ category: 'company_mission', amountCents: row.rewardCents, description: t('Фирмена мисия: {0}', title), idempotencyKey: `company-mission:${companyId}:${row.periodKey}:${row.missionId}`, refType: 'company_mission', refId: row.missionId }]);
    await addCompanyXp(tx, companyId, row.rewardXp);
    await notifyMembers(tx, companyId, null, () => t('Фирмената мисия е изпълнена: {0}', title), () => t('+{0} лв. в касата и +{1} опит за компанията.', (row.rewardCents / 100).toLocaleString(intlLocale()), row.rewardXp), '/game/company/missions');
  }
}

/** The company's missions for this week with each member's share. */
export async function companyMissionBoard(db: DbOrTx, companyId: string, now: Date) {
  const w = await ensureCompanyMissions(db, companyId, now);
  const rows = await db.select().from(companyMissionProgress).where(and(eq(companyMissionProgress.companyId, companyId), eq(companyMissionProgress.periodKey, w.key)));
  const ids = [...new Set(rows.flatMap((r) => Object.keys(r.data.members ?? {})))];
  const names = ids.length ? new Map((await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.username])) : new Map<string, string>();
  const history = await db
    .select({ periodKey: companyMissionProgress.periodKey, done: sql<number>`count(*) filter (where ${companyMissionProgress.completedAt} is not null)::int`, total: sql<number>`count(*)::int`, earned: sql<number>`coalesce(sum(${companyMissionProgress.rewardCents}) filter (where ${companyMissionProgress.completedAt} is not null), 0)::float8` })
    .from(companyMissionProgress)
    .where(and(eq(companyMissionProgress.companyId, companyId), sql`${companyMissionProgress.periodKey} <> ${w.key}`))
    .groupBy(companyMissionProgress.periodKey)
    .orderBy(sql`${companyMissionProgress.periodKey} desc`)
    .limit(6);
  return {
    window: w,
    missions: rows.map((r) => ({
      ...r,
      contributors: Object.entries(r.data.members ?? {})
        .map(([id, amount]) => ({ username: names.get(id) ?? '—', amount }))
        .sort((a, b) => b.amount - a.amount),
    })),
    history,
  };
}
