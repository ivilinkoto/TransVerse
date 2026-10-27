import { NextResponse } from 'next/server';
import { deleteAccount, deleteAccountSchema } from '@/server/auth/account-close';
import { rateLimit } from '@/server/auth/rate-limit';
import { SESSION_COOKIE } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { requireFeature } from '@/server/features';
import { handler } from '@/server/http';

/** 1.1.3: the player deletes their profile (password and username to confirm); the cookie goes too. */
export const POST = handler({ schema: deleteAccountSchema, perMinute: 5 }, async ({ user, input }) => {
  requireFeature('delete_account', user);
  await rateLimit(getDb(), `delete-account:${user.id}`, 5, 900);
  await deleteAccount(getDb(), user.id, input);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
  return response;
});
