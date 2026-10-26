import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { localeOfRequest } from '@/i18n/server';
import { users } from '@/server/db/schema';
import { register, signupSchema } from '@/server/auth/accounts';
import { verifyCaptcha } from '@/server/auth/captcha';
import { sendVerification } from '@/server/auth/email-links';
import { rateLimit } from '@/server/auth/rate-limit';
import { createSession, sessionCookie } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { ensureStarterJobs } from '@/server/game/contracts';
import { attachReferral, hashIp } from '@/server/game/referrals';
import { clientIp, handler } from '@/server/http';
import { siteUrl } from '@/server/payments/common';

export const POST = handler({ auth: false, schema: signupSchema, perMinute: 20 }, async ({ input, request }) => {
  const db = getDb();
  await rateLimit(db, `register:${await clientIp()}`, Number(process.env.REGISTER_LIMIT_PER_HOUR ?? 5), 3600);
  await verifyCaptcha(db, input.captcha);
  const userId = await register(db, input);
  // v2.0: the language the player chose before signing up (or their browser's); 1.1.2: when they agreed to the terms.
  await db.update(users).set({ locale: localeOfRequest(request), termsAcceptedAt: new Date() }).where(eq(users.id, userId));
  // Invite link: remember who invited the player (the reward comes after their first deliveries).
  await attachReferral(db, userId, input.ref, await hashIp(db, await clientIp())).catch((e) => console.warn('[register] referral failed', e));
  const { token, expiresAt } = await createSession(db, userId, request.headers.get('user-agent'));
  // Two van-sized jobs from the new HQ so the first delivery is one click away.
  await ensureStarterJobs(db, input.startCityId).catch((e) => console.warn('[register] starter jobs failed', e));
  // Confirmation e-mail (best effort — the game works without it).
  await sendVerification(db, userId, siteUrl(request.headers.get('origin'))).catch((e) => console.warn('[register] verification mail failed', e));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(token, expiresAt));
  return response;
});
