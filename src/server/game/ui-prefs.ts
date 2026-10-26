import { eq, sql } from 'drizzle-orm';
import type { Database, DbOrTx } from '@/server/db/client';
import { users } from '@/server/db/schema';

type UiPrefs = (typeof users.$inferSelect)['uiPrefs'];

/** v1.9: how the game is shown to the player (merged into what is stored). */
export async function setUiPrefs(db: Database, userId: string, input: { showAll?: boolean; boardView?: 'simple' | 'full'; seenUnlocks?: string[]; seenPage?: string; asPlayer?: boolean }) {
  const [u] = await db.select({ prefs: users.uiPrefs }).from(users).where(eq(users.id, userId));
  const prefs: UiPrefs = { ...(u?.prefs ?? {}) };
  if (input.showAll !== undefined) prefs.showAll = input.showAll;
  if (input.boardView) prefs.boardView = input.boardView;
  if (input.asPlayer !== undefined) prefs.asPlayer = input.asPlayer;
  if (input.seenUnlocks) prefs.seenUnlocks = [...new Set([...(prefs.seenUnlocks ?? []), ...input.seenUnlocks])].slice(-100);
  if (input.seenPage) prefs.seenPages = [...new Set([...(prefs.seenPages ?? []), input.seenPage])].slice(-100);
  await db.update(users).set({ uiPrefs: prefs }).where(eq(users.id, userId));
  return { prefs };
}

/**
 * The pages a player has unlocked but not yet been shown. The first time
 * (no list yet) everything already open counts as seen, so a long-time
 * player is not shown twenty windows at once.
 */
export async function pendingUnlocks(db: DbOrTx, user: { id: string; level: number; uiPrefs: UiPrefs }, open: { href: string; minLevel: number }[]) {
  const unlocked = open.filter((t) => user.level >= t.minLevel).map((t) => t.href);
  if (!user.uiPrefs.seenUnlocks) {
    await db.update(users).set({ uiPrefs: sql`${users.uiPrefs} || ${JSON.stringify({ seenUnlocks: unlocked })}::jsonb` }).where(eq(users.id, user.id));
    return [];
  }
  const seen = new Set(user.uiPrefs.seenUnlocks);
  return unlocked.filter((h) => !seen.has(h));
}
