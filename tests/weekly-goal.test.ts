import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { GOAL_LEVELS, goalMetrics, goalTarget } from '@/lib/game/weekly-goal';
import { closeDb } from '@/server/db/client';
import { coinEntries, companies, vehicles, weeklyGoals } from '@/server/db/schema';
import { acceptContract, settleDueDeliveries } from '@/server/game/deliveries';
import { GameError } from '@/server/game/errors';
import { chooseWeeklyGoal, claimWeeklyGoal, weeklyGoalState } from '@/server/game/weekly-goal';
import { db, makeContract, newPlayer } from './helpers';

afterAll(() => closeDb());

const code = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof GameError ? e.code : (e as Error).message));

describe('weekly goal', () => {
  it('sizes the targets to the pace, with floors for new players', () => {
    expect(goalTarget('deliveries', 0, 'easy')).toBe(4);
    expect(goalTarget('km', 10_000, 'hard')).toBe(15_000);
    const m = goalMetrics('seed');
    expect(new Set(Object.values(m)).size).toBe(3);
  });

  it('pick one of three, deliveries move it, the reward is taken once', async () => {
    const p = await newPlayer();
    const state = await weeklyGoalState(db(), p.userId);
    expect(state.choices.map((c) => c.difficulty)).toEqual(['easy', 'normal', 'hard']);
    const easy = state.choices[0]!;
    await chooseWeeklyGoal(db(), p.userId, 'easy');
    expect(await code(chooseWeeklyGoal(db(), p.userId, 'hard'))).toBe('goal_chosen');
    // Make the goal reachable with one trip.
    await db().update(weeklyGoals).set({ target: 1, metric: 'deliveries' }).where(and(eq(weeklyGoals.userId, p.userId), eq(weeklyGoals.weekKey, state.week)));
    expect(await code(claimWeeklyGoal(db(), p.userId, state.week))).toBe('not_done');

    const [acc] = await db().select().from(companies).where(eq(companies.ownerId, p.userId));
    const [v] = await db().select().from(vehicles).where(and(eq(vehicles.companyId, acc!.id), sql`${vehicles.soldAt} is null`));
    const d = await acceptContract(db(), p.userId, (await makeContract('Sofia', 'Plovdiv')).id, v!.id);
    await settleDueDeliveries(db(), new Date(d.etaAt.getTime() + 1000), acc!.id);
    expect((await weeklyGoalState(db(), p.userId)).goal!.progress).toBe(1);

    const r = await claimWeeklyGoal(db(), p.userId, state.week);
    expect(r).toEqual({ cents: GOAL_LEVELS.easy.cents, coins: GOAL_LEVELS.easy.coins });
    expect(easy.rewardCoins).toBe(GOAL_LEVELS.easy.coins);
    expect(await code(claimWeeklyGoal(db(), p.userId, state.week))).toBe('already_claimed');
    expect(await db().select().from(coinEntries).where(eq(coinEntries.idempotencyKey, `weekly-goal:${p.userId}:${state.week}:coins`))).toHaveLength(1);
  });
});
