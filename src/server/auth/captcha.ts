import { createHash, randomBytes, randomInt } from 'node:crypto';
import { eq, inArray, lt, sql } from 'drizzle-orm';
import { CAPTCHA, type CaptchaPuzzle } from '@/lib/captcha';
import type { DbOrTx } from '@/server/db/client';
import { captchaChallenges, rateLimits } from '@/server/db/schema';
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

const FAIL_WINDOW_S = 900;
const failKeys = (ip: string, login: string) => [`loginfail:ip:${ip}`, `loginfail:id:${login.toLowerCase()}`];

export async function loginNeedsCaptcha(db: DbOrTx, ip: string, login: string) {
  const rows = await db.select({ count: rateLimits.count }).from(rateLimits).where(sql`${inArray(rateLimits.key, failKeys(ip, login))} and ${rateLimits.windowStart} > now() - make_interval(secs => ${FAIL_WINDOW_S})`);
  return rows.some((r) => r.count >= CAPTCHA.loginAfter);
}

export async function recordLoginFailure(db: DbOrTx, ip: string, login: string) {
  for (const key of failKeys(ip, login)) {
    await db.execute(sql`
      insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
      on conflict (key) do update set
        count = case when rate_limits.window_start < now() - make_interval(secs => ${FAIL_WINDOW_S}) then 1 else rate_limits.count + 1 end,
        window_start = case when rate_limits.window_start < now() - make_interval(secs => ${FAIL_WINDOW_S}) then now() else rate_limits.window_start end`);
  }
}

export async function clearLoginFailures(db: DbOrTx, ip: string, login: string) {
  await db.delete(rateLimits).where(inArray(rateLimits.key, failKeys(ip, login)));
}

/** 1.1.2: a failed "Не съм робот" answer is counted per (hashed) address for the staff's signals. */
export async function recordCaptchaFailure(db: DbOrTx, ipHash: string | null) {
  if (!ipHash) return;
  const key = `captchafail:${ipHash.slice(0, 16)}`;
  await db.execute(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - interval '1 day' then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - interval '1 day' then now() else rate_limits.window_start end`);
}
