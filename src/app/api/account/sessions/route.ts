import { cookies } from 'next/headers';
import { signOutOthers } from '@/server/auth/account-close';
import { SESSION_COOKIE, sessionDigest } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { requireFeature } from '@/server/features';
import { handler } from '@/server/http';

/** 1.1.3: "Излез от всички други устройства" — this session stays. */
export const POST = handler({ perMinute: 5 }, async ({ user }) => {
  requireFeature('sign_out_others', user);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return { ok: true, signedOut: await signOutOthers(getDb(), user.id, token ? sessionDigest(token) : null) };
});
