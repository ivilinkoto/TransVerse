import { NextResponse } from 'next/server';
import { deleteAccountSchema, requestAccountDeletion } from '@/server/auth/account-close';
import { rateLimit } from '@/server/auth/rate-limit';
import { SESSION_COOKIE } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { requireFeature } from '@/server/features';
import { handler } from '@/server/http';
import { siteUrl } from '@/server/payments/common';

/** 1.1.3: the player asks to delete their profile (password and username); every device is signed out, the cookie goes too. */
export const POST = handler({ schema: deleteAccountSchema, perMinute: 5 }, async ({ user, input, request }) => {
  requireFeature('delete_account', user);
  await rateLimit(getDb(), `delete-account:${user.id}`, 5, 900);
  let base = '';
  try {
    base = siteUrl(request.headers.get('origin'));
  } catch {
    /* no site address */
  }
  const at = await requestAccountDeletion(getDb(), user.id, input, base);
  const response = NextResponse.json({ ok: true, at: at.toISOString() });
  response.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
  return response;
});
