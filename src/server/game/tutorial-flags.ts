import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { TUTORIAL } from '@/lib/game/tutorial';

/** True while a "visit" step is still pending (and the tutorial not dismissed). */
export async function tutorialPending(db: DbOrTx, userId: string, step: string): Promise<boolean> {
  const [u] = await db.select({ tutorial: users.tutorial }).from(users).where(eq(users.id, userId));
  return !!u && !u.tutorial.dismissed && !u.tutorial.done.includes(step);
}

/**
 * 1.3 „Нов облик“: sections open as game windows once the player is past the tutorial
 * (finished or dismissed) — during it the steps point at the pages themselves.
 */
export async function windowsLive(db: DbOrTx, userId: string, features: { game_ui?: boolean }): Promise<boolean> {
  if (!features.game_ui) return false;
  const [u] = await db.select({ tutorial: users.tutorial }).from(users).where(eq(users.id, userId));
  if (!u) return false;
  return !!u.tutorial.dismissed || TUTORIAL.every((s) => u.tutorial.done.includes(s.key));
}
