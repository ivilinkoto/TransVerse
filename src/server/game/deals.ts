import { and, eq, inArray } from 'drizzle-orm';
import { HAGGLE, haggleAccepted, sealedTier, type HagglePercent } from '@/lib/game/deals';
import { money } from '@/lib/format';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { contractHaggles, contracts, laneRecords, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { recordMonth } from '@/lib/game/community';
import { fail } from './errors';
import { post } from './finance';
import { notify } from './notify';

/** The player asks the shipper for more on a big load (once). A "no" gives the load to someone else. */
export async function haggle(db: Database, userId: string, contractId: string, percent: HagglePercent, now = new Date()) {
  if (!(await featureFor(db, userId, 'haggling', now))) fail('not_released', 'Пазарлъкът идва с обновление 1.8.');
  if (!HAGGLE.asks.some((a) => a.percent === percent)) fail('bad_ask', 'Може да поискаш +10, +20 или +30 %.');
  const [c] = await db.select().from(contracts).where(eq(contracts.id, contractId));
  if (!c || c.status !== 'open' || c.expiresAt <= now) fail('contract_unavailable', 'Поръчката вече не е налична.', 409);
  if (!haggleable(c!)) fail('no_haggle', `Пазарлък има само при обикновени поръчки от ${money(HAGGLE.minRewardCents)} нагоре.`);
  const accepted = haggleAccepted(contractId, userId, percent);
  const [row] = await db.insert(contractHaggles).values({ contractId, userId, percent, accepted, createdAt: now }).onConflictDoNothing().returning();
  if (!row) fail('already_haggled', 'Вече се пазари за тази поръчка.');
  return { accepted, percent, holdUntil: new Date(now.getTime() + HAGGLE.holdMin * 60_000).toISOString() };
}

export const haggleable = (c: Pick<typeof contracts.$inferSelect, 'rewardCents' | 'urgent' | 'tenderId' | 'rallyId' | 'featured' | 'tradeCompanyId' | 'factoryOrgId' | 'branchOrgId' | 'sharedLoadId' | 'constructionId' | 'clientContractId'> & { shady?: boolean }) =>
  c.rewardCents >= HAGGLE.minRewardCents && !c.urgent && !c.tenderId && !c.rallyId && !c.featured && !c.tradeCompanyId && !c.factoryOrgId && !c.branchOrgId && !c.sharedLoadId && !c.constructionId && !c.clientContractId && !c.shady;

/** Before a load is accepted: a "no" bars the player, a fresh "yes" gives the agreed extra percent. */
export async function agreedHaggle(db: DbOrTx, userId: string, contractId: string, now: Date) {
  const [h] = await db.select().from(contractHaggles).where(and(eq(contractHaggles.contractId, contractId), eq(contractHaggles.userId, userId)));
  if (!h) return 0;
  if (!h.accepted) fail('haggle_refused', 'Клиентът отказа пазарлъка и даде товара на друг превозвач.');
  return h.createdAt.getTime() + HAGGLE.holdMin * 60_000 > now.getTime() ? h.percent : 0;
}

/** The player's haggles over these loads (for the board). */
export async function hagglesOf(db: DbOrTx, userId: string, contractIds: string[], now: Date) {
  if (!contractIds.length) return new Map<string, { percent: number; accepted: boolean; holdUntil: string; valid: boolean }>();
  const rows = await db.select().from(contractHaggles).where(and(eq(contractHaggles.userId, userId), inArray(contractHaggles.contractId, contractIds)));
  return new Map(rows.map((r) => {
    const hold = r.createdAt.getTime() + HAGGLE.holdMin * 60_000;
    return [r.contractId, { percent: r.percent, accepted: r.accepted, holdUntil: new Date(hold).toISOString(), valid: r.accepted && hold > now.getTime() }];
  }));
}

/** On arrival: the sealed load is opened and the haggled extra is paid (both on time only for the sealed bonus). */
export async function settleDeals(tx: Tx, userId: string, d: { id: string; companyId: string; hagglePercent: number }, contract: { id: string; sealed: boolean; goods: string }, rewardCents: number, late: boolean, at: Date) {
  let total = 0;
  if (d.hagglePercent > 0) {
    const extra = Math.round((rewardCents * d.hagglePercent) / 100);
    await post(tx, d.companyId, [{ category: 'haggle_bonus', amountCents: extra, description: `Пазарлък с клиента: +${d.hagglePercent} %`, idempotencyKey: `haggle:${d.id}`, refType: 'delivery', refId: d.id }]);
    total += extra;
  }
  if (contract.sealed && (await featureFor(tx, userId, 'sealed_cargo', at))) {
    const tier = sealedTier(contract.id);
    const bonus = late ? 0 : Math.round(rewardCents * tier.bonus);
    if (bonus > 0) await post(tx, d.companyId, [{ category: 'sealed_bonus', amountCents: bonus, description: `Запечатан товар: ${tier.label} (${contract.goods})`, idempotencyKey: `sealed:${d.id}`, refType: 'delivery', refId: d.id }]);
    await notify(tx, userId, bonus ? 'achievement' : 'info', `Запечатаният товар: ${tier.label}${bonus ? ' 🎉' : ''}`, `Вътре имаше: ${contract.goods}.${bonus ? ` Бонус +${money(bonus)}.` : late ? ' Закъсня, затова без бонус.' : ' Без бонус този път.'}`, '/game/finance');
    total += bonus;
  }
  return total;
}

/** The record runs (this month) on the given lanes — the ghosts the trips race against. */
export async function ghostsFor(db: DbOrTx, lanes: { originCityId: number; destCityId: number }[], now: Date) {
  const out = new Map<string, { username: string; minutes: number; mine: boolean; userId: string }>();
  if (!lanes.length) return out;
  const rows = await db
    .select({ originCityId: laneRecords.originCityId, destCityId: laneRecords.destCityId, minutes: laneRecords.minutes, userId: laneRecords.userId, username: users.username })
    .from(laneRecords)
    .innerJoin(users, eq(users.id, laneRecords.userId))
    .where(and(eq(laneRecords.month, recordMonth(now)), inArray(laneRecords.originCityId, [...new Set(lanes.map((l) => l.originCityId))])));
  for (const r of rows) if (lanes.some((l) => l.originCityId === r.originCityId && l.destCityId === r.destCityId)) out.set(`${r.originCityId}:${r.destCityId}`, { username: r.username, minutes: r.minutes, mine: false, userId: r.userId });
  return out;
}
