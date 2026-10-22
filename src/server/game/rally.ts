import { and, desc, eq, isNotNull, lte } from 'drizzle-orm';
import { money } from '@/lib/format';
import { islandOf } from '@/lib/game/crossings';
import { periodWindow } from '@/lib/game/missions';
import { loadedMinutes, RALLY, RALLY_CATEGORIES, rallyRanking, type RallyCategory } from '@/lib/game/rally';
import { contractWindowMinutes, type Segment } from '@/lib/game/schedule';
import { haversineKm } from '@/lib/geo/geometry';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { cities, contracts, deliveries, rallies, rallyEntries, users } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { getRoute } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { postCoins } from './coins';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { loadHubs } from './contracts';
import { notify } from './notify';
import { pick } from './random';

/** Worker: the rally of this week (once per week, a random route between two big cities). */
export async function ensureRally(db: Database, now = new Date(), provider?: RoutingProvider) {
  const week = periodWindow('weekly', now);
  const [existing] = await db.select({ id: rallies.id }).from(rallies).where(eq(rallies.weekKey, week.key));
  if (existing) return null;
  const hubs = (await loadHubs(db)).filter((h) => h.population >= RALLY.minPopulation && !islandOf(h));
  const pairs: [number, number][] = [];
  for (const a of hubs) {
    for (const b of hubs) {
      if (a.id === b.id) continue;
      const km = haversineKm([a.lat, a.lon], [b.lat, b.lon]) * 1.25;
      if (km >= RALLY.minKm && km <= RALLY.maxKm) pairs.push([a.id, b.id]);
    }
  }
  if (!pairs.length) return null;
  const [from, to] = pick(pairs);
  const route = await getRoute(db, from, to, 'truck', provider);
  const [rally] = await db.insert(rallies).values({ weekKey: week.key, originCityId: from, destCityId: to, routeId: route.id, distanceKm: route.distanceKm, startsAt: now, endsAt: week.endsAt, createdAt: now }).onConflictDoNothing().returning();
  return rally ?? null;
}

/** The running rally with its cities (for the page, the board and Discord). */
export async function activeRally(db: DbOrTx) {
  const [r] = await db.select().from(rallies).where(eq(rallies.status, 'active')).orderBy(desc(rallies.startsAt)).limit(1);
  if (!r) return null;
  const names = await db.select({ id: cities.id, name: cities.nameBg }).from(cities).where(eq(cities.id, r.originCityId)).union(db.select({ id: cities.id, name: cities.nameBg }).from(cities).where(eq(cities.id, r.destCityId)));
  const name = (id: number) => names.find((c) => c.id === id)?.name ?? '';
  return { ...r, from: name(r.originCityId), to: name(r.destCityId) };
}

/**
 * The player joins the rally: their own rally load appears on the board at
 * the start city (only for them). One run a week.
 */
export async function joinRally(db: Database, userId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'rally', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  const rally = await activeRally(db);
  if (!rally || rally.endsAt <= now) fail('no_rally', 'Тази седмица няма рали.', 404);
  return db.transaction(async (tx) => {
    const [entry] = await tx.insert(rallyEntries).values({ rallyId: rally!.id, userId, createdAt: now }).onConflictDoNothing().returning();
    if (!entry) fail('already_joined', 'Вече си записан за ралито тази седмица.', 409);
    const [c] = await tx.insert(contracts).values({
      shipper: 'TransVerse Рали', goods: RALLY.goods, cargoType: RALLY.cargo, weightTons: RALLY.tons,
      originCityId: rally!.originCityId, destCityId: rally!.destCityId, routeId: rally!.routeId, distanceKm: rally!.distanceKm,
      rewardCents: Math.round(rally!.distanceKm * RALLY.rewardCentsPerKm), windowMinutes: contractWindowMinutes(rally!.distanceKm),
      rallyId: rally!.id, createdBy: userId, expiresAt: rally!.endsAt, createdAt: now,
    }).returning();
    await tx.update(rallyEntries).set({ contractId: c!.id }).where(eq(rallyEntries.id, entry!.id));
    return { contractId: c!.id, originCityId: rally!.originCityId };
  });
}

/** A rally run arrived: its loaded-leg time and its fuel cost per 100 km count. */
export async function recordRallyRun(tx: Tx, contract: { id: string; rallyId: string | null }, d: { schedule: unknown; estimatedCosts: unknown; emptyKm: number; loadedKm: number }, completedAt: Date) {
  if (!contract.rallyId) return;
  const costs = d.estimatedCosts as { fuelCents?: number };
  const km = d.emptyKm + d.loadedKm;
  const loadedFuel = km > 0 ? ((costs.fuelCents ?? 0) * d.loadedKm) / km : 0;
  await tx
    .update(rallyEntries)
    .set({ minutes: loadedMinutes(d.schedule as Segment[]), fuelCentsPer100: Math.round((loadedFuel / Math.max(1, d.loadedKm)) * 100), finishedAt: completedAt })
    .where(and(eq(rallyEntries.rallyId, contract.rallyId), eq(rallyEntries.contractId, contract.id)));
}

/** Finished runs of a rally with the drivers' names. */
export async function rallyResults(db: DbOrTx, rallyId: string) {
  const rows = await db
    .select({ userId: rallyEntries.userId, username: users.username, minutes: rallyEntries.minutes, fuelCentsPer100: rallyEntries.fuelCentsPer100, finishedAt: rallyEntries.finishedAt })
    .from(rallyEntries)
    .innerJoin(users, eq(users.id, rallyEntries.userId))
    .where(and(eq(rallyEntries.rallyId, rallyId), isNotNull(rallyEntries.finishedAt)));
  const done = rows.map((r) => ({ ...r, minutes: r.minutes!, fuelCentsPer100: r.fuelCentsPer100!, finishedAt: r.finishedAt! }));
  return { fastest: rallyRanking(done, 'fastest'), eco: rallyRanking(done, 'eco'), entries: rows.length };
}

/** Worker: after the week, the top three of both categories get their prizes. */
export async function settleRallies(db: Database, now = new Date()) {
  const due = await db.select().from(rallies).where(and(eq(rallies.status, 'active'), lte(rallies.endsAt, now)));
  for (const r of due) {
    // Runs still on the road finish first (they count).
    const [onRoad] = await db.select({ id: deliveries.id }).from(deliveries).innerJoin(contracts, eq(contracts.id, deliveries.contractId)).where(and(eq(contracts.rallyId, r.id), eq(deliveries.status, 'in_progress'))).limit(1);
    if (onRoad && r.endsAt.getTime() + 6 * 3_600_000 > now.getTime()) continue;
    const results = await rallyResults(db, r.id);
    await db.transaction(async (tx) => {
      const [mine] = await tx.update(rallies).set({ status: 'done' }).where(and(eq(rallies.id, r.id), eq(rallies.status, 'active'))).returning();
      if (!mine) return;
      await tx.update(contracts).set({ status: 'expired' }).where(and(eq(contracts.rallyId, r.id), eq(contracts.status, 'open')));
      for (const cat of ['fastest', 'eco'] as RallyCategory[]) {
        for (const [i, row] of results[cat].slice(0, RALLY.prizes.length).entries()) {
          const prize = RALLY.prizes[i]!;
          const account = await companyForUser(tx, row.userId);
          const label = `Рали ${r.weekKey}: ${RALLY_CATEGORIES[cat].toLowerCase()}, ${i + 1}. място`;
          await post(tx, account.id, [{ category: 'rally_prize', amountCents: prize.cents, description: label, idempotencyKey: `rally:${r.id}:${cat}:${row.userId}`, refType: 'rally', refId: r.id }]);
          await postCoins(tx, row.userId, { amount: prize.coins, reason: 'rally', description: label, idempotencyKey: `rally:${r.id}:${cat}:${row.userId}:coins` });
          await notify(tx, row.userId, 'achievement', `Рали: ${RALLY_CATEGORIES[cat]} — ${i + 1}. място! 🏁`, `Награда: ${money(prize.cents)} и ${prize.coins} TC.`, '/game/rally');
        }
      }
    });
  }
  return due.length;
}

/** The player's run this week. */
export async function myRallyEntry(db: DbOrTx, rallyId: string, userId: string) {
  const [e] = await db.select().from(rallyEntries).where(and(eq(rallyEntries.rallyId, rallyId), eq(rallyEntries.userId, userId)));
  return e ?? null;
}
