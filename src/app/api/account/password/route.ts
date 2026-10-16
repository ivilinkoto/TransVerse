import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { rateLimit } from '@/server/auth/rate-limit';
import { changePassword, passwordSchema } from '@/server/auth/password-change';
import { SESSION_COOKIE } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';

export const POST = handler({ schema: passwordSchema, perMinute: 10 }, async ({ user, input }) => {
  await rateLimit(getDb(), `password:${user.id}`, 5, 900);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  await changePassword(getDb(), user.id, token ? createHash('sha256').update(token).digest('hex') : null, input);
  return { ok: true };
});
