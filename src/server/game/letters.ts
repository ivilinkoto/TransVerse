/**
 * 1.2.3.6 „Писма от клиентите“: a thank-you with a bonus, a complaint, or a request for
 * the same run again (a load reserved for the player for a day).
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { LETTERS, letterKind, letterText, thanksBonus } from '@/lib/game/letters';
import { contractWindowMinutes } from '@/lib/game/schedule';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, clientLetters, contracts } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { post } from './finance';
import { notify } from './notify';
import { t as tr } from '@/i18n/t';

type Contract = typeof contracts.$inferSelect;

/** After a delivery: maybe a letter. Returns the thank-you bonus paid (0 otherwise). */
export async function clientLetter(tx: Tx, userId: string, d: { id: string; companyId: string }, contract: Contract, dest: { id: number; nameBg: string }, r: { late: boolean; rewardCents: number }, completedAt: Date): Promise<number> {
  // Only the ordinary market loads have a client who writes (not rallies, relays, tenders…).
  const c = contract;
  const special = c.rallyId || c.createdBy || c.shady || c.tradeCompanyId || c.tenderId || c.relayId || c.sharedLoadId || c.escort || c.exchange || c.constructionId || c.convoyId || c.auctionId || c.clientContractId || c.stops?.length || c.humanitarian;
  if (special || r.rewardCents <= 0) return 0;
  const kind = letterKind(`letter:${d.id}`, r.late);
  if (!kind || !(await featureFor(tx, userId, 'client_letters', completedAt))) return 0;
  const bonusCents = kind === 'thanks' ? thanksBonus(r.rewardCents) : 0;
  let contractId: string | null = null;
  if (kind === 'request') {
    const until = new Date(completedAt.getTime() + LETTERS.requestHours * 3_600_000);
    const [c] = await tx.insert(contracts).values({
      shipper: contract.shipper, goods: contract.goods, cargoType: contract.cargoType, weightTons: contract.weightTons,
      originCityId: contract.originCityId, destCityId: contract.destCityId, routeId: contract.routeId, distanceKm: contract.distanceKm,
      rewardCents: Math.round((contract.rewardCents * (1 + LETTERS.requestBonus)) / 100) * 100, windowMinutes: contractWindowMinutes(contract.distanceKm),
      reservedByCompanyId: d.companyId, reservedUntil: until, expiresAt: until, createdAt: completedAt,
    }).returning({ id: contracts.id });
    contractId = c?.id ?? null;
  }
  const [row] = await tx.insert(clientLetters).values({ userId, deliveryId: d.id, kind, client: contract.shipper, goods: contract.goods, cityId: dest.id, bonusCents, contractId, createdAt: completedAt }).onConflictDoNothing().returning({ id: clientLetters.id });
  if (!row) return 0;
  if (bonusCents) await post(tx, d.companyId, [{ category: 'client_letter', amountCents: bonusCents, description: tr('Благодарност от {0}', contract.shipper), idempotencyKey: `delivery:${d.id}:letter`, refType: 'delivery', refId: d.id }]);
  const text = () => letterText(kind, { client: contract.shipper, goods: tr(contract.goods), city: tr(dest.nameBg) });
  await notify(tx, userId, 'info', () => text().title, () => text().body, '/game/letters');
  return bonusCents;
}

/** The player's letters, newest first, with the reserved run while it is still open. */
export async function lettersView(db: DbOrTx, userId: string, now = new Date(), limit = 30) {
  const rows = await db
    .select({ l: clientLetters, city: cities.nameBg, open: sql<boolean>`${contracts.id} is not null and ${contracts.reservedUntil} > ${now} and not exists (select 1 from deliveries x where x.contract_id = ${contracts.id})` })
    .from(clientLetters)
    .innerJoin(cities, eq(cities.id, clientLetters.cityId))
    .leftJoin(contracts, eq(contracts.id, clientLetters.contractId))
    .where(eq(clientLetters.userId, userId))
    .orderBy(desc(clientLetters.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.l, city: r.city, open: !!r.open, ...letterText(r.l.kind as 'thanks', { client: r.l.client, goods: tr(r.l.goods), city: tr(r.city) }) }));
}

/** Letters not read yet (for the menu badge). */
export async function unreadLetters(db: DbOrTx, userId: string) {
  const [{ n = 0 } = {}] = await db.select({ n: sql<number>`count(*)::int` }).from(clientLetters).where(and(eq(clientLetters.userId, userId), isNull(clientLetters.readAt)));
  return n;
}

export async function markLettersRead(db: Database, userId: string, now = new Date()) {
  await db.update(clientLetters).set({ readAt: now }).where(and(eq(clientLetters.userId, userId), isNull(clientLetters.readAt)));
  return { ok: true };
}
