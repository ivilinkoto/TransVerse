import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbOrTx } from '@/server/db/client';
import { cities, companies, contracts, deliveries } from '@/server/db/schema';
import { weekKey } from '@/lib/game/leagues';

/** 1.1.4.1 „Курсът на седмицата“: the player's best paid trip since Monday — to share as a card. */
export async function bestTripOfWeek(db: DbOrTx, userId: string, now = new Date()) {
  const since = new Date(`${weekKey(now).slice(1)}T00:00:00+02:00`);
  const origin = alias(cities, 'origin');
  const dest = alias(cities, 'dest');
  const [best] = await db
    .select({ id: deliveries.id, payoutCents: deliveries.payoutCents, km: deliveries.loadedKm, sharedAt: deliveries.sharedAt, goods: contracts.goods, from: origin.nameBg, to: dest.nameBg })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(origin, eq(origin.id, contracts.originCityId))
    .innerJoin(dest, eq(dest.id, contracts.destCityId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed'), eq(deliveries.late, false), gte(deliveries.completedAt, since), isNotNull(deliveries.payoutCents)))
    .orderBy(desc(deliveries.payoutCents))
    .limit(1);
  return best ?? null;
}
