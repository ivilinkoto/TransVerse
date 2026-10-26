import { createHash, randomBytes, randomInt } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { CAPTCHA, type CaptchaPuzzle } from '@/lib/captcha';
import type { DbOrTx } from '@/server/db/client';
import { captchaChallenges } from '@/server/db/schema';
import { fail } from '@/server/game/errors';
import { t } from '@/i18n/t';

/** A new puzzle for the sign-up form (old, unsolved ones are cleared on the way). */
export async function issueCaptcha(db: DbOrTx, now = new Date()): Promise<CaptchaPuzzle> {
  await db.delete(captchaChallenges).where(lt(captchaChallenges.expiresAt, now));
  const salt = randomBytes(16).toString('hex');
  const answer = randomInt(CAPTCHA.max);
  const [row] = await db.insert(captchaChallenges).values({ salt, answer, expiresAt: new Date(now.getTime() + CAPTCHA.ttlMinutes * 60_000) }).returning({ id: captchaChallenges.id });
  return { id: row!.id, salt, challenge: createHash('sha256').update(`${salt}${answer}`).digest('hex'), max: CAPTCHA.max };
}

/** Checks a solved puzzle. Each puzzle is used up by the first try, right or wrong. */
export async function verifyCaptcha(db: DbOrTx, solution: { id: string; number: number }, now = new Date()) {
  const [row] = await db.delete(captchaChallenges).where(eq(captchaChallenges.id, solution.id)).returning();
  if (!row || row.expiresAt < now || row.answer !== solution.number) fail('captcha_failed', t('Проверката „Не съм робот“ не мина. Опитайте отново.'), 400);
}
