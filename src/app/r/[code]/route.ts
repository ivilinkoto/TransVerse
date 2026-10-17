import { NextResponse } from 'next/server';
import { REFERRAL_CODE } from '@/lib/game/referrals';

/** Invite link: remembers the code for 30 days (the friend may look around first) and opens the sign-up page. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const url = new URL(REFERRAL_CODE.test(code) ? `/register?ref=${code}` : '/register', request.url);
  const response = NextResponse.redirect(url);
  if (REFERRAL_CODE.test(code)) response.cookies.set('tv_ref', code, { maxAge: 30 * 86_400, httpOnly: true, sameSite: 'lax', path: '/' });
  return response;
}
