import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';
import { prefsSchema, setPushPrefs } from '@/server/push';

export const POST = handler({ schema: prefsSchema, perMinute: 60 }, async ({ user, input }) => {
  await setPushPrefs(getDb(), user.id, input);
  return { ok: true };
});
