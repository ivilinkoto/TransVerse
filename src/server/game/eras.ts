import { eraAt, eraFits } from '@/lib/game/eras';
import { isElectric, powerUnitModel } from '@/lib/game/catalog';
import type { Tx } from '@/server/db/client';
import { featureFor } from '@/server/features';
import { post } from './finance';
import { t } from '@/i18n/t';

/** A load that fits this month's era pays a little more (personal account). */
export async function eraBonus(tx: Tx, userId: string, d: { id: string; companyId: string; loadedKm: number }, vehicle: { modelId: string; livery: string | null }, cargo: string, rewardCents: number, now: Date) {
  if (!(await featureFor(tx, userId, 'eras', now))) return 0;
  const era = eraAt(now);
  if (!eraFits(era, { livery: vehicle.livery, electric: isElectric(powerUnitModel(vehicle.modelId)), cargo, km: d.loadedKm })) return 0;
  const bonus = Math.round(rewardCents * era.share);
  if (bonus > 0) await post(tx, d.companyId, [{ category: 'era_bonus', amountCents: bonus, description: t('{0} {1}', era.icon, t(era.label)), idempotencyKey: `delivery:${d.id}:era`, refType: 'delivery', refId: d.id }]);
  return bonus;
}
