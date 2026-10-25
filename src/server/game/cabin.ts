import { and, desc, eq, inArray } from 'drizzle-orm';
import { powerUnitModel } from '@/lib/game/catalog';
import { LANE, replayLane } from '@/lib/game/lane';
import type { Segment } from '@/lib/game/schedule';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, contracts, deliveries, jobState, routes, vehicles } from '@/server/db/schema';
import { featureFor } from '@/server/features';
import { companyForUser } from './company';
import { fail } from './errors';
import { awardXp } from './progression';
import { t } from '@/i18n/t';

/** The player's trips under way, with what the cab shows (v2.0). */
export async function cabinTrips(db: DbOrTx, userId: string) {
  const company = await companyForUser(db, userId);
  const rows = await db
    .select({ id: deliveries.id, schedule: deliveries.schedule, etaAt: deliveries.etaAt, startedAt: deliveries.startedAt, loadedKm: deliveries.loadedKm, emptyKm: deliveries.emptyKm, vehicleId: deliveries.vehicleId, contractId: deliveries.contractId, routeId: deliveries.routeId })
    .from(deliveries)
    .where(and(eq(deliveries.companyId, company.id), eq(deliveries.status, 'in_progress')))
    .orderBy(desc(deliveries.startedAt))
    .limit(10);
  if (!rows.length) return [];
  const cs = await db.select({ id: contracts.id, goods: contracts.goods, weightTons: contracts.weightTons, originCityId: contracts.originCityId, destCityId: contracts.destCityId }).from(contracts).where(inArray(contracts.id, rows.map((r) => r.contractId)));
  const vs = await db.select({ id: vehicles.id, modelId: vehicles.modelId, plate: vehicles.plate }).from(vehicles).where(inArray(vehicles.id, rows.map((r) => r.vehicleId)));
  const rs = await db.select({ id: routes.id, borders: routes.borders, countries: routes.countries }).from(routes).where(inArray(routes.id, rows.map((r) => r.routeId)));
  const cityIds = [...new Set(cs.flatMap((c) => [c.originCityId, c.destCityId]))];
  const names = await db.select({ id: cities.id, nameBg: cities.nameBg, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, cityIds));
  const played = await db.select({ key: jobState.key }).from(jobState).where(inArray(jobState.key, rows.map((r) => `lane:${r.id}`)));
  return rows.map((r) => {
    const c = cs.find((x) => x.id === r.contractId)!;
    const v = vs.find((x) => x.id === r.vehicleId);
    const route = rs.find((x) => x.id === r.routeId);
    const from = names.find((n) => n.id === c.originCityId)!;
    const to = names.find((n) => n.id === c.destCityId)!;
    return {
      id: r.id,
      goods: c.goods,
      tons: c.weightTons,
      from: from.nameBg,
      to: to.nameBg,
      /** For the light outside: the middle of the road. */
      lon: (from.lon + to.lon) / 2,
      truck: v ? `${powerUnitModel(v.modelId).name} · ${v.plate}` : '',
      segments: r.schedule as Segment[],
      emptyKm: r.emptyKm,
      loadedKm: r.loadedKm,
      borders: (route?.borders ?? []) as { km: number; from: string; to: string }[],
      countries: route?.countries ?? [],
      lanePlayed: played.some((p) => p.key === `lane:${r.id}`),
    };
  });
}

/** "Лентата": the server replays the steering of a trip under way and gives XP by the stars (once per trip). */
export async function playLane(db: Database, userId: string, deliveryId: string, inputs: number[], now = new Date()) {
  if (!(await featureFor(db, userId, 'cabin', now))) fail('not_released', t('Това идва със следващото обновление.'), 403);
  if (inputs.length > LANE.ticks) fail('too_long', t('Твърде дълго каране.'));
  const company = await companyForUser(db, userId);
  const [d] = await db.select({ id: deliveries.id, status: deliveries.status }).from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.companyId, company.id)));
  if (!d || d.status !== 'in_progress') fail('not_on_trip', t('Лентата се кара само по време на курс.'));
  const result = replayLane(deliveryId, inputs);
  return db.transaction(async (tx) => {
    const [first] = await tx.insert(jobState).values({ key: `lane:${deliveryId}`, value: { stars: result.stars, share: result.share } }).onConflictDoNothing().returning({ key: jobState.key });
    if (!first) fail('already', t('Този курс вече има резултат в Лентата.'));
    const xp = LANE.xp[result.stars] ?? 0;
    if (xp) await awardXp(tx, userId, xp, 'lane');
    return { stars: result.stars, xp, share: Math.round(result.share * 100) };
  });
}
