import { resetPassword, resetSchema } from '@/server/auth/email-links';
import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';

export const POST = handler({ auth: false, schema: resetSchema, perMinute: 10 }, async ({ input }) => {
  await resetPassword(getDb(), input);
  return { ok: true };
});
