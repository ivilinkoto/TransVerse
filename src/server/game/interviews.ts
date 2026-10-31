import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, drivers, interviews } from '@/server/db/schema';
import { INTERVIEW, INTERVIEW_ANSWERS, INTERVIEW_OCCASIONS, type InterviewAnswer, type InterviewOccasion } from '@/lib/game/interviews';
import { t } from '@/i18n/t';
import { featureFor } from '@/server/features';
import { companyForUser } from './company';
import { fail } from './errors';
import { notify } from './notify';

/** 1.1.4.2 „Интервю“: offered after a big success, at most once a week. */
export async function offerInterview(tx: Tx, userId: string, occasion: InterviewOccasion, now: Date) {
  if (!(await featureFor(tx, userId, 'interviews', now))) return false;
  const since = new Date(now.getTime() - INTERVIEW.cooldownDays * 86_400_000);
  const [recent] = await tx.select({ id: interviews.id }).from(interviews).where(and(eq(interviews.userId, userId), gt(interviews.createdAt, since))).limit(1);
  if (recent) return false;
  await tx.insert(interviews).values({ userId, occasion, createdAt: now });
  await notify(tx, userId, 'achievement', () => t('🎤 Пресата иска интервю'), () => t('Повод: {0}. Отговори от таблото.', INTERVIEW_OCCASIONS[occasion]), '/game');
  return true;
}

export async function openInterview(db: DbOrTx, userId: string) {
  const [row] = await db.select().from(interviews).where(and(eq(interviews.userId, userId), isNull(interviews.answeredAt))).orderBy(desc(interviews.createdAt)).limit(1);
  return row ?? null;
}

export async function answerInterview(db: Database, userId: string, id: string, answer: InterviewAnswer, now = new Date()) {
  if (!(answer in INTERVIEW_ANSWERS)) fail('bad_answer', t('Невалиден отговор.'));
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(interviews).where(and(eq(interviews.id, id), eq(interviews.userId, userId))).for('update');
    if (!row || row.answeredAt) fail('interview_gone', t('Интервюто вече е минало.'), 409);
    const company = await companyForUser(tx, userId);
    if (answer === 'modest') await tx.update(companies).set({ reputation: sql`least(100, ${companies.reputation} + ${INTERVIEW.modestReputation})` }).where(eq(companies.id, company.id));
    if (answer === 'team') await tx.update(drivers).set({ loyalty: sql`least(100, ${drivers.loyalty} + ${INTERVIEW.teamLoyalty})` }).where(and(eq(drivers.companyId, company.id), eq(drivers.isOwner, false)));
    await tx.update(interviews).set({ answer, answeredAt: now, effectUntil: answer === 'bold' ? new Date(now.getTime() + INTERVIEW.days * 86_400_000) : null }).where(eq(interviews.id, id));
    return { answer };
  });
}

/** „Самоуверен“ is in force: +5% on time, a double late penalty. */
export async function boldUntil(db: DbOrTx, userId: string, now: Date) {
  const [row] = await db.select({ id: interviews.id }).from(interviews).where(and(eq(interviews.userId, userId), eq(interviews.answer, 'bold'), gt(interviews.effectUntil, now))).limit(1);
  return !!row;
}
