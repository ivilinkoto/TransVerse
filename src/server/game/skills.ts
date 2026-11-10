/**
 * 1.3 „Умения на шофьора“ on the server. The ranks live in job_state under
 * `skills:<user>` = { ranks, resets }. Learning spends a point; a reset gives them
 * all back (the first free, then for money). Each delivery of the player's company
 * pays what the skills add as one ledger line (`delivery:<id>:skills`).
 */
import { eq } from 'drizzle-orm';
import { SKILL_RULES, SKILLS, skillPoints, skillsBonusCents, spentPoints, type Ranks, type SkillId, type TripForSkills } from '@/lib/game/skills';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, jobState, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { fail } from './errors';
import { post } from './finance';
import { t } from '@/i18n/t';

interface SkillState { ranks: Ranks; resets: number }
const key = (userId: string) => `skills:${userId}`;

async function readSkills(db: DbOrTx, userId: string): Promise<SkillState> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(userId)));
  return (row?.value as SkillState | undefined) ?? { ranks: {}, resets: 0 };
}

async function levelOf(db: DbOrTx, userId: string) {
  const [u] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  return u?.level ?? 1;
}

export async function skillsView(db: DbOrTx, userId: string) {
  const st = await readSkills(db, userId);
  const points = skillPoints(await levelOf(db, userId));
  const spent = spentPoints(st.ranks);
  return { ranks: st.ranks, points, spent, free: Math.max(0, points - spent), resetCents: st.resets === 0 ? 0 : SKILL_RULES.resetCents };
}

export async function learnSkill(db: DbOrTx, userId: string, skill: SkillId, now: Date) {
  if (!(skill in SKILLS)) fail('bad_skill', t('Няма такова умение.'));
  const st = await readSkills(db, userId);
  const points = skillPoints(await levelOf(db, userId));
  if (spentPoints(st.ranks) >= points) fail('no_points', t('Нямаш свободни точки — идват с всяко ново ниво.'));
  const rank = st.ranks[skill] ?? 0;
  if (rank >= SKILL_RULES.maxRank) fail('max_rank', t('Умението е на най-високото ниво.'));
  const value = { ...st, ranks: { ...st.ranks, [skill]: rank + 1 } };
  await db.insert(jobState).values({ key: key(userId), value, updatedAt: now }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: now } });
  return rank + 1;
}

/** Gives every point back: free the first time, then for money from the player's account. */
export async function resetSkills(db: Database, userId: string, now: Date) {
  return db.transaction(async (tx) => {
    const st = await readSkills(tx, userId);
    if (spentPoints(st.ranks) === 0) fail('nothing', t('Още не си научил умения.'));
    const cost = st.resets === 0 ? 0 : SKILL_RULES.resetCents;
    if (cost) {
      const [account] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
      if (!account) fail('company_not_found', t('Компанията не е намерена.'), 404);
      await post(tx, account!.id, [{ category: 'upgrades', amountCents: -cost, description: t('Нови умения на шофьора'), idempotencyKey: `skills-reset:${userId}:${st.resets + 1}` }], { requireFunds: true });
    }
    const value = { ranks: {}, resets: st.resets + 1 };
    await tx.insert(jobState).values({ key: key(userId), value, updatedAt: now }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: now } });
    return cost;
  });
}

const sofiaHour = (at: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(at));

/** A delivery of the player's company arrived: what the skills add, as one line. */
export async function recordSkillsTrip(tx: Tx, f: Omit<TripForSkills, 'sofiaHour'> & { userId: string; companyId: string; deliveryId: string }, at: Date) {
  if (!(await featureFor(tx, f.userId, 'driver_skills', at))) return;
  const st = await readSkills(tx, f.userId);
  if (spentPoints(st.ranks) === 0) return;
  const cents = skillsBonusCents(st.ranks, { ...f, sofiaHour: sofiaHour(at) });
  if (cents > 0) await post(tx, f.companyId, [{ category: 'bonus', amountCents: cents, description: t('Умения на шофьора'), idempotencyKey: `delivery:${f.deliveryId}:skills`, refType: 'delivery', refId: f.deliveryId }]);
}
