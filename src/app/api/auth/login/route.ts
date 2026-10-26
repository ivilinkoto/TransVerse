import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { LOCALE_COOKIE } from '@/i18n/config';
import { users } from '@/server/db/schema';
import { authenticate, loginSchema } from '@/server/auth/accounts';
import { rateLimit } from '@/server/auth/rate-limit';
import { createSession, sessionCookie } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { clientIp, handler } from '@/server/http';

export const POST = handler({ auth: false, schema: loginSchema, perMinute: 30 }, async ({ input, request }) => {
  const db = getDb();
  // Brute-force protection per IP and per account name.
  await rateLimit(db, `login:ip:${await clientIp()}`, 20, 900);
  await rateLimit(db, `login:id:${input.login.toLowerCase()}`, 8, 900);
  const userId = await authenticate(db, input);
  const { token, expiresAt } = await createSession(db, userId, request.headers.get('user-agent'));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(token, expiresAt));
  // v2.0: the player's language follows them to every device.
  const [u] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId));
  if (u) response.cookies.set(LOCALE_COOKIE, u.locale, { path: '/', maxAge: 365 * 24 * 3600, sameSite: 'lax' });
  return response;
});
