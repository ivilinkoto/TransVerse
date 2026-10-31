import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { jobState, users } from '@/server/db/schema';
import { t } from '@/i18n/t';
import { fail } from './errors';

/**
 * 1.1.4.2 „Отпуска“: up to 14 days. The trucks on the road finish their trips;
 * no new ones start, the salaries are not paid and the daily streak waits.
 * Once in 30 days.
 */
export const VACATION = { maxDays: 14, cooldownDays: 30 };

export async function vacationOf(db: DbOrTx, userId: string) {
  const [u] = await db.select({ until: users.vacationUntil }).from(users).where(eq(users.id, userId));
  return u?.until ?? null;
}

export const onVacation = (until: Date | null | undefined, now: Date) => !!until && until > now;

export async function setVacation(db: DbOrTx, userId: string, days: number, now = new Date()) {
  const key = `vacation:${userId}`;
  if (days <= 0) {
    await db.update(users).set({ vacationUntil: null }).where(eq(users.id, userId));
    return null;
  }
  const d = Math.min(VACATION.maxDays, Math.round(days));
  const [last] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, key));
  const from = (last?.value as { from?: string } | undefined)?.from;
  if (from && now.getTime() - new Date(from).getTime() < VACATION.cooldownDays * 86_400_000) fail('vacation_soon', t('Отпуска може веднъж на {0} дни.', VACATION.cooldownDays));
  const until = new Date(now.getTime() + d * 86_400_000);
  await db.update(users).set({ vacationUntil: until }).where(eq(users.id, userId));
  const value = { from: now.toISOString(), until: until.toISOString() };
  await db.insert(jobState).values({ key, value }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: now } });
  return until;
}

/** A daily streak survives the vacation (and the day after it). */
export const streakKept = (until: Date | null | undefined, now: Date) => !!until && now.getTime() <= until.getTime() + 36 * 3_600_000;
