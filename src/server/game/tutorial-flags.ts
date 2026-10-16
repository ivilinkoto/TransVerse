import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { users } from '@/server/db/schema';

/** True while a "visit" step is still pending (and the tutorial not dismissed). */
export async function tutorialPending(db: DbOrTx, userId: string, step: string): Promise<boolean> {
  const [u] = await db.select({ tutorial: users.tutorial }).from(users).where(eq(users.id, userId));
  return !!u && !u.tutorial.dismissed && !u.tutorial.done.includes(step);
}
