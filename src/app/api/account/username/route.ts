import { z } from 'zod';
import { changeUsername, usernameSchema } from '@/server/auth/account-data';
import { getDb } from '@/server/db/client';
import { requireFeature } from '@/server/features';
import { handler } from '@/server/http';

/** 1.1.3: a new username, once every 30 days. */
export const POST = handler({ schema: z.object({ username: usernameSchema }), perMinute: 5 }, async ({ user, input }) => {
  requireFeature('username_change', user);
  return { ok: true, username: await changeUsername(getDb(), user.id, input.username) };
});
