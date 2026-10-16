import { NextResponse } from 'next/server';
import { register, registerSchema } from '@/server/auth/accounts';
import { rateLimit } from '@/server/auth/rate-limit';
import { createSession, sessionCookie } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { ensureStarterJobs } from '@/server/game/contracts';
import { clientIp, handler } from '@/server/http';

export const POST = handler({ auth: false, schema: registerSchema, perMinute: 20 }, async ({ input, request }) => {
  const db = getDb();
  await rateLimit(db, `register:${await clientIp()}`, Number(process.env.REGISTER_LIMIT_PER_HOUR ?? 5), 3600);
  const userId = await register(db, input);
  const { token, expiresAt } = await createSession(db, userId, request.headers.get('user-agent'));
  // Two van-sized jobs from the new HQ so the first delivery is one click away.
  await ensureStarterJobs(db, input.startCityId).catch((e) => console.warn('[register] starter jobs failed', e));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie(token, expiresAt));
  return response;
});
