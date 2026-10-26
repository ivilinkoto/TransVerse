import { rateLimit } from '@/server/auth/rate-limit';
import { changeEmail, emailChangeSchema } from '@/server/auth/password-change';
import { sendVerification } from '@/server/auth/email-links';
import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';
import { siteUrl } from '@/server/payments/common';

/** 1.1.2: change the account's e-mail (Настройки → Сигурност); a confirmation mail goes to the new address. */
export const POST = handler({ schema: emailChangeSchema, perMinute: 10 }, async ({ user, input, request }) => {
  const db = getDb();
  await rateLimit(db, `email-change:${user.id}`, 3, 3600);
  await changeEmail(db, user.id, input);
  await sendVerification(db, user.id, siteUrl(request.headers.get('origin'))).catch((e) => console.warn('[email] verification mail failed', e));
  return { ok: true };
});
