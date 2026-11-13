/**
 * 1.4 „Първите 7 дни“ on the server: what each step counts is read live from what the game
 * already keeps; the claimed steps are in job_state `first-week:<user>` = { claimed: [stepId] }.
 * Rewards: money through post(), items through grantItem — each with its own idempotency key.
 */
import { and, count, eq, like, or } from 'drizzle-orm';
import { FIRST_WEEK, FIRST_WEEK_STEPS, signupDay, type FirstWeekCheck } from '@/lib/game/first-week';
import type { Database, DbOrTx } from '@/server/db/client';
import { companies, companyMembers, deliveries, jobState, userBadges, users, vehicles } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { fail } from './errors';
import { post } from './finance';
import { grantItem } from './inventory';
import { notify } from './notify';

const key = (userId: string) => `first-week:${userId}`;

async function progressOf(db: DbOrTx, userId: string): Promise<Record<FirstWeekCheck, number>> {
  const [u] = await db.select({ level: users.level }).from(users).where(eq(users.id, userId));
  const [co] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  const [{ n: done = 0 } = {}] = co ? await db.select({ n: count() }).from(deliveries).where(and(eq(deliveries.companyId, co.id), eq(deliveries.status, 'completed'))) : [];
  const [{ n: trucks = 0 } = {}] = co ? await db.select({ n: count() }).from(vehicles).where(eq(vehicles.companyId, co.id)) : [];
  const [member] = await db.select({ id: companyMembers.userId }).from(companyMembers).where(eq(companyMembers.userId, userId));
  const [route] = await db.select({ k: jobState.key }).from(jobState).where(like(jobState.key, `daily-route:%:${userId}`)).limit(1);
  const [arcade] = await db.select({ k: jobState.key }).from(jobState).where(or(like(jobState.key, `night-run:%:${userId}`), like(jobState.key, `courier:%:${userId}`))).limit(1);
  return { deliveries: Number(done), fleet: Number(trucks), company: member ? 1 : 0, daily_route: route ? 1 : 0, arcade: arcade ? 1 : 0, level: u?.level ?? 1 };
}

/** The path for a player: null when it is over (all claimed, or the third week has passed). */
export async function firstWeekView(db: DbOrTx, userId: string, now: Date) {
  const [u] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  if (!u) return null;
  const day = signupDay(u.createdAt, now);
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(userId)));
  const claimed = (row?.value as { claimed?: string[] } | undefined)?.claimed ?? [];
  if (day > FIRST_WEEK.openDays || claimed.length >= FIRST_WEEK_STEPS.length) return null;
  const p = await progressOf(db, userId);
  const steps = FIRST_WEEK_STEPS.map((s) => ({ ...s, open: day >= s.day, progress: Math.min(s.target, p[s.check]), done: p[s.check] >= s.target, claimed: claimed.includes(s.id) }));
  return { day: Math.min(day, 7), daysLeft: FIRST_WEEK.openDays - day + 1, steps, claimed: claimed.length };
}

/** Claims a step's reward (open, done, not yet claimed); the last one also gives the badge and a gold case. */
export async function claimFirstWeek(db: Database, userId: string, stepId: string, now: Date) {
  const step = FIRST_WEEK_STEPS.find((s) => s.id === stepId);
  if (!step) fail('no_step', t('Няма такава стъпка.'));
  const view = await firstWeekView(db, userId, now);
  const st = view?.steps.find((s) => s.id === stepId);
  if (!view || !st) fail('first_week_over', t('Първата седмица свърши.'));
  if (!st!.open) fail('not_yet', t('Тази стъпка се отваря на ден {0}.', step!.day));
  if (!st!.done) fail('not_done', t('Още не е изпълнено.'));
  return db.transaction(async (tx) => {
    await tx.insert(jobState).values({ key: key(userId), value: { claimed: [] } }).onConflictDoNothing();
    const [row] = await tx.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key(userId))).for('update');
    const claimed = (row!.value as { claimed: string[] }).claimed;
    if (claimed.includes(stepId)) fail('claimed', t('Наградата вече е взета.'));
    const [co] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
    if (co && step!.cents) await post(tx, co.id, [{ category: 'bonus', amountCents: step!.cents, description: t('Първите 7 дни: {0}', step!.label), idempotencyKey: `first-week:${userId}:${stepId}` }]);
    for (const i of step!.items ?? []) await grantItem(tx, userId, i.itemId, i.qty, 'first_week', `first-week:${userId}:${stepId}:${i.itemId}`);
    const next = [...claimed, stepId];
    await tx.update(jobState).set({ value: { claimed: next }, updatedAt: now }).where(eq(jobState.key, key(userId)));
    const all = next.length === FIRST_WEEK_STEPS.length;
    if (all) {
      await grantItem(tx, userId, FIRST_WEEK.final.itemId, FIRST_WEEK.final.qty, 'first_week', `first-week:${userId}:final`);
      await tx.insert(userBadges).values({ userId, badge: FIRST_WEEK.badge, awardedAt: now }).onConflictDoNothing();
      await notify(tx, userId, 'achievement', () => t('Първите 7 дни — готово!'), () => t('Значка „Първите 7 дни“ и златен кейс. Добре дошъл в TransVerse!'), '/game/inventory');
    }
    return { ok: true, all };
  });
}
