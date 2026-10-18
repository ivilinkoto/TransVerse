import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Segment } from '@/lib/game/schedule';
import type { DbOrTx } from '@/server/db/client';
import { cities, companies, companyMembers, contracts, deliveries, friendships, organizations, routes, users, vehicles } from '@/server/db/schema';
import { onlineUserIds } from '@/server/realtime';
import { isVip } from '@/lib/game/vip';

/** A leg of another player's trip; the geometry is shared through `routes` to keep the payload small. */
export interface WorldLeg {
  routeId: number;
  from: [number, number];
  to: [number, number];
  km: number;
}

export interface WorldTruck {
  id: string;
  player: string;
  role: string;
  vip: boolean;
  company: string | null;
  tag: string | null;
  color: string | null;
  online: boolean;
  /** How the viewer knows this player: a friend, a member of the viewer's company, or nobody. */
  relation: 'friend' | 'company' | null;
  /** Parking position when idle. */
  position: [number, number];
  city: string;
  delivery: null | { schedule: Segment[]; empty: WorldLeg | null; loaded: WorldLeg; destination: string };
}

export interface WorldSnapshot {
  trucks: WorldTruck[];
  /** Encoded polylines (precision 6) by route id; null = no road geometry (approximate line). */
  routes: Record<number, string | null>;
  players: number;
  online: number;
}

/** Idle trucks of players who were not active recently are left out to keep the map readable. */
const IDLE_ACTIVE_DAYS = 14;
const MAX_TRUCKS = 3000;

/**
 * Every player's trucks for the shared world map: where they stand or the
 * schedule they drive. Clients animate positions locally from the schedules,
 * so the map moves in real time without polling every second. Contains no
 * money or contract terms — only who drives where.
 */
export async function worldSnapshot(db: DbOrTx, now = new Date(), viewerId?: string): Promise<WorldSnapshot> {
  const { friends, mates } = viewerId ? await circleOf(db, viewerId) : { friends: new Set<string>(), mates: new Set<string>() };
  const activeSince = new Date(now.getTime() - IDLE_ACTIVE_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: vehicles.id,
      status: vehicles.status,
      userId: users.id,
      player: users.username,
      role: users.role,
      vipUntil: users.vipUntil,
      company: organizations.name,
      tag: organizations.tag,
      color: organizations.color,
      lat: cities.lat,
      lon: cities.lon,
      city: cities.nameBg,
    })
    .from(vehicles)
    .innerJoin(companies, eq(companies.id, vehicles.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .innerJoin(cities, eq(cities.id, vehicles.cityId))
    .leftJoin(companyMembers, eq(companyMembers.userId, users.id))
    .leftJoin(organizations, eq(organizations.id, companyMembers.companyId))
    .where(
      and(
        isNull(vehicles.soldAt),
        isNull(users.bannedAt),
        sql`(${vehicles.status} = 'on_delivery' or ${users.lastSeenAt} >= ${activeSince} or ${users.createdAt} >= ${activeSince}
             or exists (select 1 from deliveries d where d.company_id = ${companies.id} and d.started_at >= ${activeSince}))`,
      ),
    )
    .orderBy(sql`${vehicles.status} = 'on_delivery' desc`, sql`${users.lastSeenAt} desc nulls last`)
    .limit(MAX_TRUCKS);

  const moving = rows.filter((r) => r.status === 'on_delivery').map((r) => r.id);
  const trips = moving.length
    ? await db
        .select({ vehicleId: deliveries.vehicleId, schedule: deliveries.schedule, routeId: deliveries.routeId, emptyRouteId: deliveries.emptyRouteId, emptyKm: deliveries.emptyKm, loadedKm: deliveries.loadedKm, originCityId: contracts.originCityId, destCityId: contracts.destCityId })
        .from(deliveries)
        .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
        .where(and(inArray(deliveries.vehicleId, moving), eq(deliveries.status, 'in_progress')))
    : [];
  const routeIds = [...new Set(trips.flatMap((t) => [t.routeId, t.emptyRouteId].filter((x): x is number => x != null)))];
  const routeRows = routeIds.length ? await db.select({ id: routes.id, geometry: routes.geometry, fromCityId: routes.fromCityId }).from(routes).where(inArray(routes.id, routeIds)) : [];
  const cityIds = [...new Set([...trips.flatMap((t) => [t.originCityId, t.destCityId]), ...routeRows.map((r) => r.fromCityId)])];
  const cityRows = cityIds.length ? await db.select({ id: cities.id, lat: cities.lat, lon: cities.lon, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, cityIds)) : [];
  const cityById = new Map(cityRows.map((c) => [c.id, c]));
  const routeById = new Map(routeRows.map((r) => [r.id, r]));
  const tripByVehicle = new Map(trips.map((t) => [t.vehicleId, t]));
  const ll = (id: number): [number, number] => {
    const c = cityById.get(id)!;
    return [c.lat, c.lon];
  };

  const online = onlineUserIds();
  const trucks: WorldTruck[] = rows.map((r) => {
    const t = tripByVehicle.get(r.id);
    let delivery: WorldTruck['delivery'] = null;
    if (t && cityById.has(t.originCityId) && cityById.has(t.destCityId)) {
      const emptyFrom = t.emptyRouteId ? routeById.get(t.emptyRouteId)?.fromCityId : undefined;
      delivery = {
        schedule: t.schedule as Segment[],
        loaded: { routeId: t.routeId, from: ll(t.originCityId), to: ll(t.destCityId), km: t.loadedKm },
        empty: t.emptyRouteId && emptyFrom && cityById.has(emptyFrom) ? { routeId: t.emptyRouteId, from: ll(emptyFrom), to: ll(t.originCityId), km: t.emptyKm } : null,
        destination: cityById.get(t.destCityId)!.nameBg,
      };
    }
    return {
      id: r.id,
      player: r.player,
      role: r.role,
      vip: isVip(r.vipUntil, now),
      company: r.company,
      tag: r.tag,
      color: r.color,
      online: online.has(r.userId),
      relation: friends.has(r.userId) ? 'friend' : mates.has(r.userId) ? 'company' : null,
      position: [r.lat, r.lon],
      city: r.city,
      delivery,
    };
  });
  const players = new Set(rows.map((r) => r.userId));
  return {
    trucks,
    routes: Object.fromEntries(routeRows.map((r) => [r.id, r.geometry])),
    players: players.size,
    online: [...players].filter((id) => online.has(id)).length,
  };
}

/** The viewer's friends and the other members of their company (user ids). */
export async function circleOf(db: DbOrTx, userId: string) {
  const [friendRows, mateRows] = await Promise.all([
    db
      .select({ id: sql<string>`case when ${friendships.requesterId} = ${userId} then ${friendships.addresseeId} else ${friendships.requesterId} end` })
      .from(friendships)
      .where(and(eq(friendships.status, 'accepted'), sql`(${friendships.requesterId} = ${userId} or ${friendships.addresseeId} = ${userId})`)),
    db
      .select({ id: companyMembers.userId })
      .from(companyMembers)
      .where(sql`${companyMembers.companyId} = (select company_id from company_members where user_id = ${userId}) and ${companyMembers.userId} <> ${userId}`),
  ]);
  return { friends: new Set(friendRows.map((r) => r.id)), mates: new Set(mateRows.map((r) => r.id)) };
}
