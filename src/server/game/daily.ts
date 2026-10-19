import { and, eq, gt, sql } from 'drizzle-orm';
import { dailyState, dayKey, yesterdayKey } from '@/lib/game/daily';
import type { Database } from '@/server/db/client';
import { jobState, users } from '@/server/db/schema';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';
import { awardXp } from './progression';

/** Claims today's reward exactly once (row lock + one ledger key per player and day). */
export async function claimDaily(db: Database, userId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ streak: users.loginStreak, last: users.dailyClaimKey }).from(users).where(eq(users.id, userId)).for('update');
    if (!u) fail('user_not_found', 'Профилът не е намерен.', 404);
    const state = dailyState(u!.streak, u!.last, now);
    if (state.claimedToday) fail('already_claimed', 'Днешната награда вече е взета. Ела утре за следващата!', 409);
    const account = await companyForUser(tx, userId);
    const label = `Дневна награда — ден ${state.cycleDay}`;
    await post(tx, account.id, [{ category: 'daily_reward', amountCents: state.reward.cents, description: `${label} (серия ${state.nextStreak})`, idempotencyKey: `daily:${userId}:${state.today}` }]);
    if (state.reward.xp) await awardXp(tx, userId, state.reward.xp, 'daily');
    if (state.reward.coins) await postCoins(tx, userId, { amount: state.reward.coins, reason: 'daily_reward', description: label, idempotencyKey: `daily-coins:${userId}:${state.today}` });
    await tx.update(users).set({ loginStreak: state.nextStreak, dailyClaimKey: state.today }).where(eq(users.id, userId));
    return { ...state.reward, streak: state.nextStreak, cycleDay: state.cycleDay };
  });
}

/**
 * Worker, once a day in the evening (Bulgarian time): players with a streak of
 * 2+ days who have not claimed today get a reminder before the streak is lost.
 */
export async function dailyReminders(db: Database, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hour12: false }).format(now));
  if (hour < 19) return 0;
  const today = dayKey(now);
  const [state] = await db.select().from(jobState).where(eq(jobState.key, 'daily-reminder'));
  if ((state?.value as { day?: string } | undefined)?.day === today) return 0;
  await db.insert(jobState).values({ key: 'daily-reminder', value: { day: today } }).onConflictDoUpdate({ target: jobState.key, set: { value: { day: today }, updatedAt: now } });
  const due = await db
    .select({ id: users.id, streak: users.loginStreak })
    .from(users)
    .where(and(eq(users.dailyClaimKey, yesterdayKey(now)), sql`${users.loginStreak} >= 2`, sql`${users.bannedAt} is null`, gt(users.lastSeenAt, new Date(now.getTime() - 7 * 86_400_000))))
    .limit(5000);
  for (const u of due) await notify(db, u.id, 'info', `Не губи серията си от ${u.streak} дни!`, 'Дневната награда те чака — вземи я преди полунощ.', '/game#daily');
  return due.length;
}
