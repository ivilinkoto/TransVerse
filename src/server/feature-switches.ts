import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { FEATURES, type FeatureId } from '@/lib/game/features';
import { recordAudit, requireAdminRole, requireStaff, type Staff } from '@/server/admin';
import { fail } from '@/server/game/errors';
import { t } from '@/i18n/t';

/**
 * 1.1.4.1, the admin panel: a released feature can be switched off for the
 * players when something goes wrong — the menu, the pages and the commands of
 * that feature — without a new deploy. The team keeps it, to test the fix.
 * Background jobs are not affected.
 */
const KEY = 'features:off';
let cache: { at: number; off: Set<FeatureId> } | null = null;

export async function disabledFeatures(db: DbOrTx, fresh = false): Promise<Set<FeatureId>> {
  if (!fresh && cache && Date.now() - cache.at < 30_000 && !process.env.VITEST) return cache.off;
  const [row] = await db.select({ value: jobState.value }).from(jobState).where(eq(jobState.key, KEY));
  const ids = ((row?.value as { ids?: string[] } | undefined)?.ids ?? []).filter((id): id is FeatureId => id in FEATURES);
  cache = { at: Date.now(), off: new Set(ids) };
  return cache.off;
}

/** The player's features with the switched-off ones removed (the team sees them). */
export function withSwitches<T extends Record<FeatureId, boolean>>(features: T, off: ReadonlySet<FeatureId>, staff: boolean): T {
  if (staff || !off.size) return features;
  const out = { ...features };
  for (const id of off) out[id] = false as T[FeatureId];
  return out;
}

export async function setFeatureOff(db: DbOrTx, actor: Staff | null, id: string, off: boolean) {
  requireStaff(actor);
  requireAdminRole(actor);
  if (!(id in FEATURES)) fail('unknown_feature', t('Непозната функция.'));
  const now = await disabledFeatures(db, true);
  const next = new Set(now);
  if (off) next.add(id as FeatureId);
  else next.delete(id as FeatureId);
  const value = { ids: [...next] };
  await db.insert(jobState).values({ key: KEY, value }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: new Date() } });
  cache = null;
  await recordAudit(db, actor.id, off ? 'feature_off' : 'feature_on', null, { feature: id });
}
