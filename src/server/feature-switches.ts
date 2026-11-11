import type { DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { disabledFeatures, FEATURES_OFF_KEY, forgetDisabledFeatures } from '@/server/feature-off';
import { FEATURES, type FeatureId } from '@/lib/game/features';
import { recordAudit, requireAdminRole, requireStaff, type Staff } from '@/server/admin';
import { fail } from '@/server/game/errors';
import { t } from '@/i18n/t';

/**
 * 1.1.4.1, the admin panel: a released feature can be switched off for the
 * players when something goes wrong — the menu, the pages and the commands of
 * that feature — without a new deploy. The team keeps it, to test the fix.
 * Background jobs are not affected; a delivery's bonuses are (they ask `featureFor`).
 */
export { disabledFeatures };
/** The player's features with the switched-off ones removed (the team sees them). */
export function withSwitches<T extends Record<FeatureId, boolean>>(features: T, off: ReadonlySet<FeatureId>, staff: boolean): T {
  if (staff || !off.size) return features;
  const out = { ...features };
  for (const id of off) out[id] = false as T[FeatureId];
  return out;
}

export async function setFeatureOff(db: DbOrTx, actor: Staff | null, id: string, off: boolean, reason = '') {
  requireStaff(actor);
  requireAdminRole(actor);
  if (!(id in FEATURES)) fail('unknown_feature', t('Непозната функция.'));
  const now = await disabledFeatures(db, true);
  const next = new Set(now);
  if (off) next.add(id as FeatureId);
  else next.delete(id as FeatureId);
  const value = { ids: [...next] };
  await db.insert(jobState).values({ key: FEATURES_OFF_KEY, value }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: new Date() } });
  forgetDisabledFeatures();
  // 1.1.4.2: why, for the history in Система.
  await recordAudit(db, actor.id, off ? 'feature_off' : 'feature_on', null, { feature: id, reason: reason.trim().slice(0, 200) });
}
