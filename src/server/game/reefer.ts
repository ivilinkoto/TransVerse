import { eq } from 'drizzle-orm';
import { OUTCOME_LABELS, outcomeShare, rangeFor, simulateReefer, slipChance } from '@/lib/game/reefer';
import type { Tx } from '@/server/db/client';
import { deliveries, trailers } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { post } from './finance';
import { notify } from './notify';
import { t } from '@/i18n/t';

/** On arrival of a refrigerated load: how its temperature held, and what that pays or costs. */
export async function settleReefer(tx: Tx, userId: string, d: { id: string; companyId: string; trailerId: string | null; startedAt: Date; etaAt: Date }, contract: { cargoType: string; goods: string }, vehicleCondition: number, rewardCents: number, at: Date, rand = Math.random) {
  if (contract.cargoType !== 'refrigerated' || rewardCents <= 0 || !(await featureFor(tx, userId, 'reefer', at))) return 0;
  const [trailer] = d.trailerId ? await tx.select({ condition: trailers.condition }).from(trailers).where(eq(trailers.id, d.trailerId)) : [];
  const range = rangeFor(contract.goods);
  const month = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', month: 'numeric' }).format(at));
  const chance = slipChance({ condition: trailer?.condition ?? vehicleCondition, hours: (d.etaAt.getTime() - d.startedAt.getTime()) / 3_600_000, summer: month >= 6 && month <= 8, strict: range.strict });
  const { readings, outcome } = simulateReefer(range, chance, rand);
  const cents = Math.round(rewardCents * outcomeShare(outcome));
  await tx.update(deliveries).set({ reefer: { min: range.min, max: range.max, readings, outcome, cents } }).where(eq(deliveries.id, d.id));
  if (cents) await post(tx, d.companyId, [{ category: cents > 0 ? 'bonus' : 'penalty', amountCents: cents, description: `${OUTCOME_LABELS[outcome]} (${range.min}…${range.max} °C)`, idempotencyKey: `delivery:${d.id}:reefer`, refType: 'delivery', refId: d.id }]);
  if (outcome !== 'perfect') await notify(tx, userId, 'warning', () => outcome === 'spoiled' ? t('Стоката се развали: {0} 🌡️', contract.goods) : t('Температурата излезе от нормата 🌡️'), () => t('{0} — {1} лв. Хладилният агрегат пази по-добре, когато е в добро състояние (ремонт в сервиза).', OUTCOME_LABELS[outcome], cents / 100), `/game/trips/${d.id}`);
  return cents;
}
