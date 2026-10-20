import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { featureLive } from '@/lib/game/features';
import { isStaff } from '@/server/auth/roles';
import { SESSION_COOKIE, validateSession } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { appUrl, discordConfig } from '@/server/discord/config';
import { discordAuthorizeUrl } from '@/server/discord/link';

export const dynamic = 'force-dynamic';

/** "Свържи Discord": sends the player to Discord to allow the link. */
export async function GET() {
  const jar = await cookies();
  const session = await validateSession(getDb(), jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.redirect(`${appUrl()}/login`);
  if (!discordConfig().oauth || !featureLive('discord_bot', new Date(), isStaff(session.user.role))) return NextResponse.redirect(`${appUrl()}/game/settings?discord=off#discord`);
  const state = randomBytes(18).toString('base64url');
  const res = NextResponse.redirect(discordAuthorizeUrl(state));
  res.cookies.set('tv_discord_state', state, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/api/discord', maxAge: 600 });
  return res;
}
