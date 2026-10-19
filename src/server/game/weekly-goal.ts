import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { money } from '@/lib/format';
import { periodWindow } from '@/lib/game/missions';
import { GOAL_LEVELS, GOAL_METRICS, goalIncrement, goalMetrics, goalTarget, type GoalDifficulty, type GoalMetric } from '@/lib/game/weekly-goal';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, contracts, deliveries, weeklyGoals } from '@/server/db/schema';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';

/** The player's average week over the last four (deliveries, loaded km, tonnes). */
async function averageWeek(db: DbOrTx, userId: string, now: Date): Promise<Record<GoalMetric, number>> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int`, km: sql<number>`coalesce(sum(${deliveries.loadedKm}), 0)::float`, tons: sql<number>`coalesce(sum(${contracts.weightTons}), 0)::float` })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, new Date(now.getTime() - 28 * 86_400_000))));
  return { deliveries: (row?.n ?? 0) / 4, km: (row?.km ?? 0) / 4, tons: (row?.tons ?? 0) / 4 };
}

/** This week's three choices for the player (or the chosen goal with its progress). */
export async function weeklyGoalState(db: DbOrTx, userId: string, now = new Date()) {
  const week = periodWindow('weekly', now);
  const describe = (g: typeof weeklyGoals.$inferSelect) => ({ ...g, title: GOAL_METRICS[g.metric as GoalMetric].label(g.target), level: GOAL_LEVELS[g.difficulty as GoalDifficulty].label });
  // Last week's goal, finished but not claimed yet, can still be taken.
  const lastKey = periodWindow('weekly', new Date(now.getTime() - 7 * 86_400_000)).key;
  const [last] = await db.select().from(weeklyGoals).where(and(eq(weeklyGoals.userId, userId), eq(weeklyGoals.weekKey, lastKey), isNull(weeklyGoals.claimedAt)));
  const previous = last && last.progress >= last.target ? describe(last) : null;
  const [goal] = await db.select().from(weeklyGoals).where(and(eq(weeklyGoals.userId, userId), eq(weeklyGoals.weekKey, week.key)));
  if (goal) return { week: week.key, endsAt: week.endsAt, goal: describe(goal), previous, choices: [] };
  const avg = await averageWeek(db, userId, now);
  const metrics = goalMetrics(`${userId}:${week.key}`);
  const choices = (Object.keys(GOAL_LEVELS) as GoalDifficulty[]).map((difficulty) => {
    const metric = metrics[difficulty];
    const target = goalTarget(metric, avg[metric], difficulty);
    return { difficulty, metric, target, title: GOAL_METRICS[metric].label(target), level: GOAL_LEVELS[difficulty].label, rewardCents: GOAL_LEVELS[difficulty].cents, rewardCoins: GOAL_LEVELS[difficulty].coins };
  });
  return { week: week.key, endsAt: week.endsAt, goal: null, previous, choices };
}

/** The player picks this week's goal (once a week). */
export async function chooseWeeklyGoal(db: Database, userId: string, difficulty: GoalDifficulty, now = new Date()) {
  if (!GOAL_LEVELS[difficulty]) fail('invalid_goal', 'Непозната цел.');
  const state = await weeklyGoalState(db, userId, now);
  if (state.goal) fail('goal_chosen', 'Целта за тази седмица вече е избрана.', 409);
  const c = state.choices.find((x) => x.difficulty === difficulty)!;
  const [row] = await db
    .insert(weeklyGoals)
    .values({ userId, weekKey: state.week, difficulty, metric: c.metric, target: c.target, rewardCents: c.rewardCents, rewardCoins: c.rewardCoins, endsAt: state.endsAt, createdAt: now })
    .onConflictDoNothing()
    .returning();
  if (!row) fail('goal_chosen', 'Целта за тази седмица вече е избрана.', 409);
  return row!;
}

/** A delivery of the player arrived: it moves this week's goal (never past the target). */
export async function recordWeeklyGoal(tx: Tx, userId: string, load: { loadedKm: number; tons: number }, now: Date) {
  const week = periodWindow('weekly', now).key;
  const [g] = await tx.select().from(weeklyGoals).where(and(eq(weeklyGoals.userId, userId), eq(weeklyGoals.weekKey, week), isNull(weeklyGoals.claimedAt))).for('update');
  if (!g || g.progress >= g.target) return;
  const progress = Math.min(g.target, g.progress + goalIncrement(g.metric as GoalMetric, load));
  await tx.update(weeklyGoals).set({ progress }).where(and(eq(weeklyGoals.userId, userId), eq(weeklyGoals.weekKey, week)));
  if (progress >= g.target) await notify(tx, userId, 'achievement', 'Седмичната цел е изпълнена!', `${GOAL_METRICS[g.metric as GoalMetric].label(g.target)} — вземи наградата: ${money(g.rewardCents)} и ${g.rewardCoins} TC.`, '/game/missions');
}

/** Takes the reward of a finished goal (this week or the last one). */
export async function claimWeeklyGoal(db: Database, userId: string, weekKey: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(weeklyGoals).where(and(eq(weeklyGoals.userId, userId), eq(weeklyGoals.weekKey, weekKey))).for('update');
    if (!g) fail('not_found', 'Няма такава цел.', 404);
    if (g!.claimedAt) fail('already_claimed', 'Наградата вече е взета.');
    if (g!.progress < g!.target) fail('not_done', 'Целта още не е изпълнена.');
    // A week later the reward is gone.
    if (now.getTime() > g!.endsAt.getTime() + 7 * 86_400_000) fail('expired', 'Срокът за наградата изтече.');
    await tx.update(weeklyGoals).set({ claimedAt: now }).where(and(eq(weeklyGoals.userId, userId), eq(weeklyGoals.weekKey, weekKey)));
    const account = await companyForUser(tx, userId);
    await post(tx, account.id, [{ category: 'mission_reward', amountCents: g!.rewardCents, description: `Седмична цел: ${GOAL_METRICS[g!.metric as GoalMetric].label(g!.target)}`, idempotencyKey: `weekly-goal:${userId}:${weekKey}` }]);
    await postCoins(tx, userId, { amount: g!.rewardCoins, reason: 'weekly_goal', description: 'Седмична цел', idempotencyKey: `weekly-goal:${userId}:${weekKey}:coins` });
    return { cents: g!.rewardCents, coins: g!.rewardCoins };
  });
}
