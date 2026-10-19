import { eq } from 'drizzle-orm';
import { featureLive, type FeatureId } from '@/lib/game/features';
import { isStaff } from '@/server/auth/roles';
import type { DbOrTx } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { fail } from '@/server/game/errors';

/** Is the feature on for this player (staff test it before the release date)? */
export async function featureFor(db: DbOrTx, userId: string, id: FeatureId, now = new Date()): Promise<boolean> {
  if (featureLive(id, now)) return true;
  const [u] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  return !!u && isStaff(u.role);
}

/** Refuses an action of a feature that is not out yet for this player. */
export function requireFeature(id: FeatureId, role: string, now = new Date()) {
  if (!featureLive(id, now, isStaff(role))) fail('not_released', 'Това идва със следващото обновление.', 403);
}
