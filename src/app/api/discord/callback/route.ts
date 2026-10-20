import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, validateSession } from '@/server/auth/session';
import { getDb } from '@/server/db/client';
import { appUrl } from '@/server/discord/config';
import { discordAccountFromCode, linkDiscord } from '@/server/discord/link';
import { GameError } from '@/server/game/errors';

export const dynamic = 'force-dynamic';

/** Discord sends the player back here after "Authorize": the account is linked. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const back = (status: string) => {
    const res = NextResponse.redirect(`${appUrl()}/game/settings?discord=${status}#discord`);
    res.cookies.delete({ name: 'tv_discord_state', path: '/api/discord' });
    return res;
  };
  const db = getDb();
  const session = await validateSession(db, jar.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.redirect(`${appUrl()}/login`);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!code || !state || state !== jar.get('tv_discord_state')?.value) return back('error');
  try {
    const account = await discordAccountFromCode(code);
    await linkDiscord(db, session.user.id, account);
    return back('ok');
  } catch (error) {
    if (error instanceof GameError && error.code === 'discord_taken') return back('taken');
    console.error('[discord] link failed', (error as Error).message);
    return back('error');
  }
}
