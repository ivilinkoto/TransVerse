import { NextResponse } from 'next/server';
import { REFERRAL_CODE } from '@/lib/game/referrals';

/**
 * Invite link: remembers the code for 30 days (the friend may look around first) and opens the sign-up page.
 * The redirect is relative: behind the proxy `request.url` is the internal address (127.0.0.1:3000).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const valid = REFERRAL_CODE.test(code);
  const response = new NextResponse(null, { status: 307, headers: { Location: valid ? `/register?ref=${code}` : '/register' } });
  if (valid) response.cookies.set('tv_ref', code, { maxAge: 30 * 86_400, httpOnly: true, sameSite: 'lax', path: '/' });
  return response;
}
