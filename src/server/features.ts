import { eq } from 'drizzle-orm';
import { featureLive, type FeatureId } from '@/lib/game/features';
import { testsUnreleased } from '@/server/auth/roles';
import type { DbOrTx } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { fail } from '@/server/game/errors';
import { t } from '@/i18n/t';

// The role per connection or transaction: one settlement asks for many features of the same player.
const roles = new WeakMap<object, Map<string, boolean>>();

/** Is the feature on for this player (staff test it before the release date)? */
export async function featureFor(db: DbOrTx, userId: string, id: FeatureId, now = new Date()): Promise<boolean> {
  if (featureLive(id, now)) return true;
  let known = roles.get(db);
  if (!known) roles.set(db, (known = new Map()));
  if (!known.has(userId)) {
    const [u] = await db.select({ role: users.role, uiPrefs: users.uiPrefs }).from(users).where(eq(users.id, userId));
    known.set(userId, !!u && testsUnreleased(u));
    // A long-lived connection forgets the roles after a while (a promotion shows up within a minute).
    if (known.size === 1) setTimeout(() => roles.delete(db), 60_000).unref?.();
  }
  return !!known.get(userId);
}

/** Refuses an action of a feature that is not out yet for this player. */
export function requireFeature(id: FeatureId, user: { role: string; asPlayer?: boolean }, now = new Date()) {
  if (!featureLive(id, now, testsUnreleased(user))) fail('not_released', t('Това идва със следващото обновление.'), 403);
}
