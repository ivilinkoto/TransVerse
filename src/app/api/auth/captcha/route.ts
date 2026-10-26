import { issueCaptcha } from '@/server/auth/captcha';
import { rateLimit } from '@/server/auth/rate-limit';
import { getDb } from '@/server/db/client';
import { clientIp, handler } from '@/server/http';

export const dynamic = 'force-dynamic';

/** 1.1.2: a sign-up puzzle (see src/lib/captcha.ts). */
export const GET = handler({ auth: false, perMinute: 20 }, async () => {
  const db = getDb();
  await rateLimit(db, `captcha:${await clientIp()}`, 60, 3600);
  return issueCaptcha(db);
});
