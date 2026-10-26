import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { LOCALE_COOKIE, LOCALES } from '@/i18n/config';
import { getDb } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { currentUser, handler } from '@/server/http';

/** v2.0: the player picks a language — a cookie for every page, and the profile when signed in (messages, e-mails). */
export const POST = handler({ auth: false, schema: z.object({ locale: z.enum(LOCALES) }), perMinute: 30 }, async ({ input }) => {
  const user = await currentUser();
  if (user) await getDb().update(users).set({ locale: input.locale }).where(eq(users.id, user.id));
  const res = NextResponse.json({ ok: true, locale: input.locale });
  res.cookies.set(LOCALE_COOKIE, input.locale, { path: '/', maxAge: 365 * 24 * 3600, sameSite: 'lax' });
  return res;
});
