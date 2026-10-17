import { sendVerification } from '@/server/auth/email-links';
import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';
import { siteUrl } from '@/server/payments/common';

/** Re-sends the address confirmation link to the signed-in player. */
export const POST = handler({ perMinute: 5 }, async ({ user, request }) => {
  const sent = await sendVerification(getDb(), user.id, siteUrl(request.headers.get('origin')));
  return { ok: true, sent };
});
