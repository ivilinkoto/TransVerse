import polyline from '@mapbox/polyline';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { money } from '@/lib/format';
import { ROAD_EVENTS, type RoadEventPlan } from '@/lib/game/road-events';
import { helpableStop, ROADSIDE, shortenStop } from '@/lib/game/roadside';
import { scheduleEnd, stateAt, type Segment } from '@/lib/game/schedule';
import { haversineKm, pointAlong, type LatLon } from '@/lib/geo/geometry';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, roadsideHelps, routes, users, vehicles } from '@/server/db/schema';
import { companyForUser } from './company';
import { fail } from './errors';
import { post } from './finance';
import { broadcast, notify } from './notify';
import { recordChristmasHelp } from './christmas';
import { awardXp } from './progression';
import { circleOf } from './world-map';

type Trip = Pick<typeof deliveries.$inferSelect, 'schedule' | 'emptyRouteId' | 'routeId' | 'contractId'>;

/** Where a truck on a trip is now: a point along the real route geometry (or the straight line when there is none). */
export async function tripPosition(db: DbOrTx, d: Trip, now: Date): Promise<LatLon | null> {
  const st = stateAt(d.schedule as Segment[], now.getTime());
  const routeId = st.leg === 'empty' ? d.emptyRouteId : d.routeId;
  if (!routeId) {
    // No empty leg: the truck is at the pickup.
    const [c] = await db.select({ lat: cities.lat, lon: cities.lon }).from(contracts).innerJoin(cities, eq(cities.id, contracts.originCityId)).where(eq(contracts.id, d.contractId));
    return c ? [c.lat, c.lon] : null;
  }
  const [r] = await db.select({ geometry: routes.geometry, km: routes.distanceKm, fromCityId: routes.fromCityId, toCityId: routes.toCityId }).from(routes).where(eq(routes.id, routeId));
  if (!r) return null;
  let points: LatLon[];
  if (r.geometry) points = polyline.decode(r.geometry, 6) as LatLon[];
  else {
    const ends = await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, [r.fromCityId, r.toCityId]));
    const at = (id: number) => ends.find((c) => c.id === id);
    if (!at(r.fromCityId) || !at(r.toCityId)) return null;
    points = [[at(r.fromCityId)!.lat, at(r.fromCityId)!.lon], [at(r.toCityId)!.lat, at(r.toCityId)!.lon]];
  }
  return pointAlong(points, r.km > 0 ? st.km / r.km : 0);
}

/** The distance from the helper's nearest truck (parked or on a trip) to a point, km. */
async function nearestTruckKm(db: DbOrTx, userId: string, to: LatLon, now: Date): Promise<number | null> {
  const account = await companyForUser(db, userId);
  const fleet = await db
    .select({ id: vehicles.id, status: vehicles.status, lat: cities.lat, lon: cities.lon })
    .from(vehicles)
    .innerJoin(cities, eq(cities.id, vehicles.cityId))
    .where(and(eq(vehicles.companyId, account.id), isNull(vehicles.soldAt)));
  const trips = fleet.some((v) => v.status === 'on_delivery')
    ? await db.select({ vehicleId: deliveries.vehicleId, schedule: deliveries.schedule, emptyRouteId: deliveries.emptyRouteId, routeId: deliveries.routeId, contractId: deliveries.contractId }).from(deliveries).where(and(eq(deliveries.companyId, account.id), eq(deliveries.status, 'in_progress')))
    : [];
  let best: number | null = null;
  for (const v of fleet) {
    const trip = v.status === 'on_delivery' ? trips.find((t) => t.vehicleId === v.id) : undefined;
    const at = trip ? await tripPosition(db, trip, now) : ([v.lat, v.lon] as LatLon);
    if (!at) continue;
    const km = haversineKm(at, to);
    if (best === null || km < best) best = km;
  }
  return best;
}

/**
 * A friend or company colleague helps a truck that stands after a breakdown,
 * ice, snow or a closed pass: the rest of the stop is halved, the arrival
 * moves earlier, and the helper gets a fee, XP and reputation. Once per stop.
 */
export async function helpOnRoad(db: Database, helperId: string, deliveryId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(deliveries).where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'in_progress'))).for('update');
    if (!d) fail('trip_over', 'Курсът вече е приключил.', 409);
    const stop = helpableStop(d!.schedule as Segment[], now.getTime());
    if (!stop) fail('no_stop', 'Камионът вече не чака помощ.', 409);
    const [owner] = await tx.select({ id: users.id, username: users.username }).from(companies).innerJoin(users, eq(users.id, companies.ownerId)).where(eq(companies.id, d!.companyId));
    if (!owner || owner.id === helperId) fail('self', 'Не можеш да помогнеш на собствения си камион.');
    const circle = await circleOf(tx, helperId);
    if (!circle.friends.has(owner!.id) && !circle.mates.has(owner!.id)) fail('not_friend', 'Може да помагаш на приятели и на колеги от компанията.', 403);
    const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(roadsideHelps).where(and(eq(roadsideHelps.helperId, helperId), gte(roadsideHelps.createdAt, new Date(now.getTime() - 86_400_000))));
    if (n >= ROADSIDE.dailyLimit) fail('daily_limit', `Може да помагаш до ${ROADSIDE.dailyLimit} пъти за 24 часа.`);
    const where = await tripPosition(tx, d!, now);
    const km = where ? await nearestTruckKm(tx, helperId, where, now) : null;
    if (km === null || km > ROADSIDE.radiusKm) fail('too_far', `Нямаш камион до ${ROADSIDE.radiusKm} км от мястото${km !== null ? ` (най-близкият е на ${Math.round(km)} км)` : ''}.`);

    const savedMs = Math.round((stop!.end - now.getTime()) * ROADSIDE.cut);
    const [help] = await tx.insert(roadsideHelps).values({ deliveryId: d!.id, stopAt: new Date(stop!.start), helperId, savedMs, feeCents: ROADSIDE.feeCents, createdAt: now }).onConflictDoNothing().returning({ id: roadsideHelps.id });
    if (!help) fail('already_helped', 'Някой вече помогна на този камион.', 409);

    // The schedule after the stop moves earlier; so does the matching road event (later events are timed from the applied delays).
    const schedule = shortenStop(d!.schedule as Segment[], stop!, savedMs);
    const incidents = (d!.schedule as Segment[]).filter((s) => s.kind === 'incident');
    const nth = incidents.findIndex((s) => s.start === stop!.start);
    let seen = -1;
    const events = (d!.roadEvents as RoadEventPlan[]).map((e) => (e.applied && ++seen === nth ? { ...e, delayMs: Math.max(0, e.delayMs - savedMs) } : e));
    await tx
      .update(deliveries)
      .set({ schedule, roadEvents: events, etaAt: new Date(scheduleEnd(schedule)), nextEventAt: d!.nextEventAt ? new Date(d!.nextEventAt.getTime() - savedMs) : null })
      .where(eq(deliveries.id, d!.id));

    const [helper] = await tx.select({ username: users.username }).from(users).where(eq(users.id, helperId));
    const account = await companyForUser(tx, helperId);
    await post(tx, account.id, [{ category: 'roadside_help', amountCents: ROADSIDE.feeCents, description: `Помощ на пътя: ${owner!.username} (${stop!.note})`, idempotencyKey: `roadside:${help!.id}`, refType: 'delivery', refId: d!.id }]);
    const [acc] = await tx.select({ reputation: companies.reputation }).from(companies).where(eq(companies.id, account.id)).for('update');
    await tx.update(companies).set({ reputation: Math.min(100, acc!.reputation + ROADSIDE.reputation) }).where(eq(companies.id, account.id));
    await awardXp(tx, helperId, ROADSIDE.xp, 'roadside');
    await recordChristmasHelp(tx, helperId, now);
    const minutes = Math.max(1, Math.round(savedMs / 60_000));
    await notify(tx, owner!.id, 'success', `${helper!.username} ти помогна на пътя`, `${stop!.note}: камионът тръгва ${minutes} мин. по-рано.`, '/game/fleet');
    await notify(tx, helperId, 'success', 'Помогна на колега', `${owner!.username} тръгва ${minutes} мин. по-рано. Хонорар ${money(ROADSIDE.feeCents)}, +${ROADSIDE.xp} опит и репутация.`, '/game/finance');
    await broadcast(tx, 'world');
    return { savedMs, feeCents: ROADSIDE.feeCents };
  });
}

/** When a truck stops for a helpable event: tells the owner's online friends and colleagues. */
export async function askForHelp(tx: DbOrTx, ownerId: string, kind: keyof typeof ROAD_EVENTS, place: string | null, now: Date) {
  if (!ROADSIDE.kinds.includes(kind)) return 0;
  const circle = await circleOf(tx, ownerId);
  const ids = [...new Set([...circle.friends, ...circle.mates])];
  if (!ids.length) return 0;
  const online = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), gte(users.lastSeenAt, new Date(now.getTime() - 10 * 60_000)), isNull(users.bannedAt)));
  const [me] = await tx.select({ username: users.username }).from(users).where(eq(users.id, ownerId));
  for (const u of online) await notify(tx, u.id, 'info', `${me!.username} чака помощ на пътя`, `${ROAD_EVENTS[kind].title}${place ? ` по пътя за ${place}` : ''}. Ако имаш камион наблизо (до ${ROADSIDE.radiusKm} км), помогни от картата — хонорар ${money(ROADSIDE.feeCents)}`, '/game/map');
  return online.length;
}
