/**
 * 1.2.4 „Преди зимата“ (feature `winter_prep`): the server goal in tonnes of
 * winter goods (job_state `prewinter:<year>` = { tons, reachedAt }), the
 * badge for five on-time winter loads, and +5% on new loads in the first week
 * of winter when the goal was reached.
 */
import { eq, sql } from 'drizzle-orm';
import { featureLive } from '@/lib/game/features';
import { isFirstWinterWeek, isPrewinter, PREWINTER, prewinterKey } from '@/lib/game/prewinter';
import type { DbOrTx, Tx } from '@/server/db/client';
import { jobState, userBadges } from '@/server/db/schema';
import { postCoins } from './coins';
import { notify } from './notify';
import { t } from '@/i18n/t';

interface Goal { tons: number; reachedAt?: string | null }

async function goalOf(db: DbOrTx, key: string): Promise<Goal> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key));
  return { tons: 0, ...((row?.value as Goal | undefined) ?? {}) };
}

/** The goal of this year: how many tonnes are in and whether it is reached. */
export async function prewinterGoal(db: DbOrTx, now: Date) {
  const g = await goalOf(db, prewinterKey(now));
  return { tons: Math.round(g.tons), goal: PREWINTER.goalTons, reached: !!g.reachedAt, share: Math.min(1, g.tons / PREWINTER.goalTons) };
}

async function addTons(tx: Tx, key: string, tons: number, at: Date) {
  const [row] = await tx
    .insert(jobState)
    .values({ key, value: { tons } })
    .onConflictDoUpdate({ target: jobState.key, set: { value: sql`jsonb_set(${jobState.value}, '{tons}', to_jsonb(coalesce((${jobState.value}->>'tons')::numeric, 0) + ${tons}))`, updatedAt: at } })
    .returning({ value: jobState.value });
  const g = row!.value as Goal;
  if (Number(g.tons) >= PREWINTER.goalTons && !g.reachedAt) {
    await tx.update(jobState).set({ value: sql`jsonb_set(${jobState.value}, '{reachedAt}', to_jsonb(${at.toISOString()}::text))` }).where(eq(jobState.key, key));
  }
}

/** A delivery arrived: winter goods count for the server goal; five on time give the badge. */
export async function recordPrewinterDelivery(tx: Tx, userId: string, f: { holiday: string | null; tons: number; late: boolean }, at: Date) {
  if (f.holiday !== 'prewinter' || !featureLive('winter_prep', at)) return;
  const key = prewinterKey(at);
  // The goal counts what arrives until 30 November; a load taken late in the month still counts for the badge.
  if (isPrewinter(at)) await addTons(tx, key, f.tons, at);
  if (f.late) return;
  const mine = `${key}:${userId}`;
  const [count] = await tx
    .insert(jobState)
    .values({ key: mine, value: { loads: 1 } })
    .onConflictDoUpdate({ target: jobState.key, set: { value: sql`jsonb_set(${jobState.value}, '{loads}', to_jsonb(coalesce((${jobState.value}->>'loads')::int, 0) + 1))`, updatedAt: at } })
    .returning({ value: jobState.value });
  if ((count!.value as { loads: number }).loads !== PREWINTER.loadsForBadge) return;
  const [badge] = await tx.insert(userBadges).values({ userId, badge: PREWINTER.badge, awardedAt: at }).onConflictDoNothing().returning();
  if (!badge) return;
  await postCoins(tx, userId, { amount: PREWINTER.coins, reason: 'holiday_reward', description: t('Значка „Зимна готовност“'), idempotencyKey: `${mine}:badge` });
  await notify(tx, userId, 'achievement', () => t('Значка: Зимна готовност'), () => t('{0} зимни товара навреме — и {1} TC.', PREWINTER.loadsForBadge, PREWINTER.coins), '/game/profile');
}

/** How many winter loads the player delivered on time this year. */
export async function prewinterLoadsOf(db: DbOrTx, userId: string, now: Date) {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, `${prewinterKey(now)}:${userId}`));
  return (row?.value as { loads?: number } | undefined)?.loads ?? 0;
}

/** New loads in the first week of winter pay +5% when the server reached the goal. */
export async function winterWeekPay(db: DbOrTx, now: Date) {
  if (!isFirstWinterWeek(now) || !featureLive('winter_prep', now)) return 1;
  return (await goalOf(db, prewinterKey(now))).reachedAt ? PREWINTER.winterWeek.multiplier : 1;
}

/** Winter and all-season tyres cost less until the end of November. */
export const winterTyreDiscount = (upgradeId: string, now: Date, live: boolean) => (live && isPrewinter(now) && (upgradeId === 'winter_tyres' || upgradeId === 'all_season_tyres') ? PREWINTER.tyreDiscount : 0);
