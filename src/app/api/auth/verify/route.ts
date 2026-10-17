import { z } from 'zod';
import { verifyEmail } from '@/server/auth/email-links';
import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';

/** Confirms the address from the e-mail link (a button press, so link scanners cannot use the link up). */
export const POST = handler({ auth: false, schema: z.object({ token: z.string().max(100) }), perMinute: 20 }, async ({ input }) => {
  await verifyEmail(getDb(), input.token);
  return { ok: true };
});
