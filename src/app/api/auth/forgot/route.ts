import { forgotSchema, requestPasswordReset } from '@/server/auth/email-links';
import { getDb } from '@/server/db/client';
import { clientIp, handler } from '@/server/http';
import { siteUrl } from '@/server/payments/common';

/** Always the same answer, whether or not the address is registered. */
export const POST = handler({ auth: false, schema: forgotSchema, perMinute: 10 }, async ({ input, request }) => {
  const { mailEnabled } = await requestPasswordReset(getDb(), input, await clientIp(), siteUrl(request.headers.get('origin')));
  return { ok: true, mailEnabled };
});
