import { and, asc, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import { featureFor } from '@/server/features';
import { CONVOY_RULES } from '@/lib/game/convoy';
import type { DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, users } from '@/server/db/schema';
import { notify } from './notify';
import { circleOf } from './world-map';

/** Friends' and company members' trips on this lane that left recently and have no convoy yet. */
export async function convoyCandidates(db: DbOrTx, userId: string, now: Date, lane?: { originCityId: number; destCityId: number }) {
  const { friends, mates } = await circleOf(db, userId);
  const ids = [...new Set([...friends, ...mates])];
  if (!ids.length) return [];
  return db
    .select({ deliveryId: deliveries.id, userId: users.id, username: users.username, originCityId: contracts.originCityId, destCityId: contracts.destCityId, startedAt: deliveries.startedAt })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .where(
      and(
        inArray(users.id, ids),
        eq(deliveries.status, 'in_progress'),
        isNull(deliveries.convoyWith),
        gte(deliveries.startedAt, new Date(now.getTime() - CONVOY_RULES.windowMs)),
        ...(lane ? [eq(contracts.originCityId, lane.originCityId), eq(contracts.destCityId, lane.destCityId)] : []),
      ),
    )
    .orderBy(asc(deliveries.startedAt));
}

/** A new trip joins the earliest matching one into a convoy; both players are told. */
export async function formConvoy(tx: Tx, delivery: { id: string; companyId: string }, userId: string, lane: { originCityId: number; destCityId: number }, now: Date) {
  if (!(await featureFor(tx, userId, 'convoy', now))) return null;
  const [partner] = (await convoyCandidates(tx, userId, now, lane)).filter((c) => c.deliveryId !== delivery.id);
  if (!partner) return null;
  // Lock the partner's trip so two new trips cannot both join it.
  const [locked] = await tx.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.id, partner.deliveryId), isNull(deliveries.convoyWith), ne(deliveries.id, delivery.id))).for('update');
  if (!locked) return null;
  await tx.update(deliveries).set({ convoyWith: delivery.id }).where(eq(deliveries.id, partner.deliveryId));
  await tx.update(deliveries).set({ convoyWith: partner.deliveryId }).where(eq(deliveries.id, delivery.id));
  const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, userId));
  const names = await tx.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, [lane.originCityId, lane.destCityId]));
  const name = (id: number) => names.find((c) => c.id === id)?.nameBg ?? '';
  const bonus = `${Math.round(CONVOY_RULES.bonusShare * 100)} %`;
  const route = `${name(lane.originCityId)} → ${name(lane.destCityId)}`;
  await notify(tx, userId, 'success', `Конвой с ${partner.username}`, `${route}: карате заедно — +${bonus} към наградата за всеки, ако пристигнете навреме.`, '/game/map');
  await notify(tx, partner.userId, 'success', `Конвой с ${me!.username}`, `${me!.username} тръгна след теб по ${route}: +${bonus} към наградата за всеки, ако пристигнете навреме.`, '/game/map');
  return partner;
}
