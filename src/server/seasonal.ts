import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { activeSeason, parseSeasonMode, type SeasonId, type SeasonMode } from '@/lib/game/seasonal';
import { getDb, type DbOrTx } from '@/server/db/client';
import { jobState, sessions, users } from '@/server/db/schema';
import { SESSION_COOKIE, sessionDigest } from '@/server/auth/session';

const KEY = 'setting:seasonal-theme';

export async function seasonMode(db: DbOrTx): Promise<SeasonMode> {
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, KEY));
  return parseSeasonMode(row?.value);
}

export async function setSeasonMode(db: DbOrTx, mode: SeasonMode) {
  await db.insert(jobState).values({ key: KEY, value: mode }).onConflictDoUpdate({ target: jobState.key, set: { value: mode, updatedAt: new Date() } });
}

/**
 * The season for this request: the site's season, unless the signed-in
 * player switched decorations off. Never fails the page (no season on error).
 */
export const requestSeason = cache(async (): Promise<SeasonId | null> => {
  try {
    const db = getDb();
    const season = activeSeason(new Date(), await seasonMode(db));
    if (!season) return null;
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token && token.length <= 100) {
      const id = sessionDigest(token);
      const [row] = await db
        .select({ on: users.seasonalTheme })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
      if (row && !row.on) return null;
    }
    return season;
  } catch {
    return null;
  }
});
