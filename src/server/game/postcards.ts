/**
 * 1.2.3.6: the 3D postcard of a delivery — the first load to a city or a long trip,
 * with the player's own truck. The picture is drawn in the browser from these data.
 */
import { and, eq, lt, ne, sql } from 'drizzle-orm';
import { POSTCARD, postcardReason, postcardScene } from '@/lib/game/postcard';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, jobState, trailers, users, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { postGameLine } from './chat-life';
import { fail } from './errors';
import { notify } from './notify';
import { t as tr } from '@/i18n/t';

/** Whether the company had delivered to this city before `before` (other deliveries only). */
async function visitedBefore(db: DbOrTx, companyId: string, cityId: number, deliveryId: string, before: Date) {
  const [row] = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(and(eq(deliveries.companyId, companyId), eq(contracts.destCityId, cityId), eq(deliveries.status, 'completed'), ne(deliveries.id, deliveryId), lt(deliveries.completedAt, before)))
    .limit(1);
  return !!row;
}

/** On arrival: a new postcard tells the player (the first time in a city, or after a long trip). */
export async function postcardOnArrival(tx: Tx, userId: string, d: { id: string; companyId: string; loadedKm: number }, destCityId: number, city: string, completedAt: Date) {
  if (!(await featureFor(tx, userId, 'delivery_postcard', completedAt))) return;
  const first = !(await visitedBefore(tx, d.companyId, destCityId, d.id, completedAt));
  const reason = postcardReason(first, d.loadedKm);
  if (!reason) return;
  await notify(tx, userId, 'info', () => tr('📸 Нова 3D картичка: {0}', tr(city)), () => (reason === 'first_city' ? tr('Първи курс до {0}! Камионът ти позира пред града.', tr(city)) : tr('Дълъг курс до {0}. Виж камиона си в 3D и го покажи в чата.', tr(city))), `/game/postcard/${d.id}`);
}

/** Everything the postcard draws; null when the trip has no postcard. */
export async function postcardView(db: DbOrTx, deliveryId: string) {
  const [row] = await db
    .select({ d: deliveries, destCityId: contracts.destCityId, originCityId: contracts.originCityId, goods: contracts.goods, tons: contracts.weightTons, ownerId: companies.ownerId, username: users.username, v: { modelId: vehicles.modelId, color: vehicles.color, plate: vehicles.plate, nickname: vehicles.nickname, cosmetics: vehicles.cosmetics, condition: vehicles.condition } })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .innerJoin(vehicles, eq(vehicles.id, deliveries.vehicleId))
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'completed')));
  if (!row?.d.completedAt) return null;
  const first = !(await visitedBefore(db, row.d.companyId, row.destCityId, row.d.id, row.d.completedAt));
  const reason = postcardReason(first, row.d.loadedKm);
  if (!reason) return null;
  const ends = await db.select({ id: cities.id, name: cities.nameBg, country: cities.countryCode }).from(cities).where(sql`${cities.id} in (${row.originCityId}, ${row.destCityId})`);
  const [trailer] = row.d.trailerId ? await db.select({ modelId: trailers.modelId }).from(trailers).where(eq(trailers.id, row.d.trailerId)) : [];
  const to = ends.find((c) => c.id === row.destCityId);
  return {
    id: row.d.id,
    ownerId: row.ownerId,
    username: row.username,
    reason,
    scene: postcardScene(reason, row.d.completedAt),
    city: to?.name ?? '',
    country: to?.country ?? '',
    from: ends.find((c) => c.id === row.originCityId)?.name ?? '',
    km: Math.round(row.d.loadedKm),
    goods: row.goods,
    tons: row.tons,
    completedAt: row.d.completedAt.toISOString(),
    truck: { modelId: row.v.modelId, color: row.v.color, plate: row.v.plate, nickname: row.v.nickname, cosmetics: row.v.cosmetics, condition: row.v.condition, trailerModelId: trailer?.modelId ?? null },
  };
}

/** Shows the postcard in the global chat (once per trip, and not more often than every few hours). */
export async function sharePostcard(db: Database, userId: string, deliveryId: string, now = new Date()) {
  const card = await postcardView(db, deliveryId);
  if (!card || card.ownerId !== userId) fail('not_found', tr('Няма картичка за този курс.'), 404);
  return db.transaction(async (tx) => {
    const key = `postcard-share:${userId}`;
    const [row] = await tx.select({ updatedAt: jobState.updatedAt, value: jobState.value }).from(jobState).where(eq(jobState.key, key)).for('update');
    const shared = ((row?.value as { ids?: string[] } | undefined)?.ids ?? []);
    if (shared.includes(deliveryId)) fail('already_shared', tr('Тази картичка вече е в чата.'));
    if (row && now.getTime() - row.updatedAt.getTime() < POSTCARD.shareEveryHours * 3_600_000) fail('too_soon', tr('Следващата картичка — след {0} ч.', POSTCARD.shareEveryHours));
    const value = { ids: [...shared, deliveryId].slice(-50) };
    await tx.insert(jobState).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: now } });
    const line = card!.reason === 'first_city' ? tr('📸 {0} стигна за първи път до {1}! Виж камиона в 3D.', card!.username, card!.city) : tr('📸 {0} докара {1} на {2} км до {3}. Виж камиона в 3D.', card!.username, card!.goods, card!.km, card!.city);
    await postGameLine(tx, 'global', 'postcard', line, { href: `/game/postcard/${deliveryId}`, button: tr('Виж картичката') }, now);
    return { ok: true };
  });
}

export type Postcard = NonNullable<Awaited<ReturnType<typeof postcardView>>>;
