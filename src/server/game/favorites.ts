import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { favoriteLanes } from '@/server/db/schema';
import { fail } from './errors';
import { notify } from './notify';

export const MAX_FAVORITE_LANES = 20;

export async function favoriteLanesOf(db: DbOrTx, userId: string) {
  return db.select({ originCityId: favoriteLanes.originCityId, destCityId: favoriteLanes.destCityId }).from(favoriteLanes).where(eq(favoriteLanes.userId, userId));
}

/** Stars or un-stars a lane; returns whether it is a favourite now. */
export async function toggleFavoriteLane(db: DbOrTx, userId: string, originCityId: number, destCityId: number): Promise<boolean> {
  const where = and(eq(favoriteLanes.userId, userId), eq(favoriteLanes.originCityId, originCityId), eq(favoriteLanes.destCityId, destCityId));
  const removed = await db.delete(favoriteLanes).where(where).returning({ u: favoriteLanes.userId });
  if (removed.length) return false;
  const mine = await favoriteLanesOf(db, userId);
  if (mine.length >= MAX_FAVORITE_LANES) fail('too_many_favorites', `Най-много ${MAX_FAVORITE_LANES} любими линии.`);
  await db.insert(favoriteLanes).values({ userId, originCityId, destCityId }).onConflictDoNothing();
  return true;
}

/** A new job on the board: tells the players who starred its lane (at most once an hour per lane). */
export async function notifyFavoriteLane(db: DbOrTx, lane: { contractId?: string; originCityId: number; destCityId: number; originName: string; destName: string; goods: string; rewardCents: number }, now = new Date()) {
  const due = await db
    .update(favoriteLanes)
    .set({ notifiedAt: now })
    .where(and(eq(favoriteLanes.originCityId, lane.originCityId), eq(favoriteLanes.destCityId, lane.destCityId), or(isNull(favoriteLanes.notifiedAt), lt(favoriteLanes.notifiedAt, new Date(now.getTime() - 3_600_000)))))
    .returning({ userId: favoriteLanes.userId });
  for (const { userId } of due) {
    await notify(db, userId, 'info', `Нова поръчка: ${lane.originName} → ${lane.destName}`, `${lane.goods} за ${Math.round(lane.rewardCents / 100).toLocaleString('bg-BG')} лв. по твоя любима линия.`, lane.contractId ? `/game/contracts?fav=1&load=${lane.contractId}` : '/game/contracts?fav=1');
  }
  return due.length;
}
