import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { LOCALE_COOKIE } from '@/i18n/config';
import { users } from '@/server/db/schema';
import { authenticate, loginSchema } from '@/server/auth/accounts';
import { clearLoginFailures, loginNeedsCaptcha, recordCaptchaFailure, recordLoginFailure, verifyCaptcha } from '@/server/auth/captcha';
import { hashIp } from '@/server/game/referrals';
import { rateLimit } from '@/server/auth/rate-limit';
import { fail, GameError } from '@/server/game/errors';
import { t } from '@/i18n/t';
import { createSession, sessionCookie } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { afterLogin } from '@/server/auth/login-events';
import { siteUrl } from '@/server/payments/common';
import { clientIp, handler } from '@/server/http';

export const POST = handler({ auth: false, schema: loginSchema, perMinute: 30 }, async ({ input, request }) => {
  const db = getDb();
  // Brute-force protection per IP and per account name.
  await rateLimit(db, `login:ip:${await clientIp()}`, 20, 900);
  await rateLimit(db, `login:id:${input.login.toLowerCase()}`, 8, 900);
  // 1.1.2: after a few wrong passwords the form asks "Не съм робот" too.
  const ip = await clientIp();
  if (await loginNeedsCaptcha(db, ip, input.login)) {
    if (!input.captcha) fail('captcha_required', t('Няколко грешни опита — потвърдете, че не сте робот.'), 400);
    await verifyCaptcha(db, input.captcha!).catch(async (e: unknown) => {
      await recordCaptchaFailure(db, await hashIp(db, ip));
      throw e;
    });
  }
  const userId = await authenticate(db, input).catch(async (e: unknown) => {
    if (e instanceof GameError && e.code === 'invalid_credentials') await recordLoginFailure(db, ip, input.login);
    throw e;
  });
  await clearLoginFailures(db, ip, input.login);
  const { token, expiresAt } = await createSession(db, userId, request.headers.get('user-agent'));
  // 1.1.3: remembers the device, cancels a pending deletion, mails about a new device.
  let base = '';
  try {
    base = siteUrl(request.headers.get('origin'));
  } catch {
    /* no site address: the mail link stays relative */
  }
  await afterLogin(db, userId, request.headers.get('user-agent'), base);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(token, expiresAt));
  // v2.0: the player's language follows them to every device.
  const [u] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId));
  if (u) response.cookies.set(LOCALE_COOKIE, u.locale, { path: '/', maxAge: 365 * 24 * 3600, sameSite: 'lax' });
  return response;
});
