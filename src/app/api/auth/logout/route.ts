import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, revokeSession } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { handler } from '@/server/http';

export const POST = handler({ auth: false }, async () => {
  const jar = await cookies();
  await revokeSession(getDb(), jar.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
  return response;
});
