import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { FEATURES, type FeatureId } from '@/lib/game/features';

/**
 * The features the admins switched off (`features:off` in job_state), cached for 30 s.
 * Kept apart from `feature-switches.ts` (which needs the admin module) so that
 * `featureFor` can read it without an import cycle.
 */
export const FEATURES_OFF_KEY = 'features:off';
let cache: { at: number; off: Set<FeatureId> } | null = null;

export async function disabledFeatures(db: DbOrTx, fresh = false): Promise<Set<FeatureId>> {
  if (!fresh && cache && Date.now() - cache.at < 30_000 && !process.env.VITEST) return cache.off;
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, FEATURES_OFF_KEY));
  const ids = ((row?.value as { ids?: string[] } | undefined)?.ids ?? []).filter((id): id is FeatureId => id in FEATURES);
  cache = { at: Date.now(), off: new Set(ids) };
  return cache.off;
}

/** Forgets the cached list (after a switch). */
export function forgetDisabledFeatures() {
  cache = null;
}
