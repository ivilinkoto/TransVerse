import { cookies } from 'next/headers';
import { z } from 'zod';
import { signOutOthers, signOutSession } from '@/server/auth/account-close';
import { SESSION_COOKIE, sessionDigest } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { requireFeature } from '@/server/features';
import { handler } from '@/server/http';

const currentId = async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sessionDigest(token) : null;
};

/** 1.1.3: "Излез от всички други устройства", or one device (`key`) — this session stays. */
export const POST = handler({ schema: z.object({ key: z.string().max(32).optional() }), perMinute: 10 }, async ({ user, input }) => {
  requireFeature('sign_out_others', user);
  if (input.key) {
    requireFeature('session_list', user);
    await signOutSession(getDb(), user.id, input.key, await currentId());
    return { ok: true, signedOut: 1 };
  }
  return { ok: true, signedOut: await signOutOthers(getDb(), user.id, await currentId()) };
});
