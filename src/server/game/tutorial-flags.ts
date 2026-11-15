import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { users } from '@/server/db/schema';

/** True while a "visit" step is still pending (and the tutorial not dismissed). */
export async function tutorialPending(db: DbOrTx, userId: string, step: string): Promise<boolean> {
  const [u] = await db.select({ tutorial: users.tutorial }).from(users).where(eq(users.id, userId));
  return !!u && !u.tutorial.dismissed && !u.tutorial.done.includes(step);
}

/**
 * 1.3 „Нов облик“: sections open as game windows whenever the new look is on, for every
 * player. They used to wait until the tutorial was finished or dismissed, so a player still
 * in it (or who had never finished it) got full page loads everywhere; the windows render
 * the same pages, so the tutorial's visit steps are still marked inside them.
 * The db and userId are kept so the callers stay as they are.
 */
export async function windowsLive(db: DbOrTx, userId: string, features: { game_ui?: boolean; simple_menu?: boolean }): Promise<boolean> {
  // 1.3.2 „Просто“: sections are full pages again; windows stay for the small tools only.
  return !!features.game_ui && !features.simple_menu;
}
