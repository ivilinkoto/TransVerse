import { eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import type { MapProps, MapVehicle } from '@/components/game/WorldMap';
import { km } from '@/lib/format';
import { cities, contracts, depots, routes } from '@/server/db/schema';
import { fleetView, routeGeometries } from './queries';
import { isMarta } from '@/lib/game/marta';
import { storkOfDay } from './marta';
import { allianceBases } from './alliances';
import { activeReports } from './live-road';
import { REPORT_KINDS } from '@/lib/game/live-road';
import { tx } from '@/i18n/t';
import { GAME_COUNTRIES } from '@/lib/geo/scope';
import { isSnowTime, roadCondition } from '@/lib/game/winter';
import { realConditions } from './weather';

/**
 * What the map shows for a player: own trucks with their routes, depots, a
 * route preview for one load, and the extras of the season. Used by the map
 * page and (1.2.2) by the compact map on top of „Курсове“.
 */
export async function mapData(db: DbOrTx, ctx: { userId: string; companyId: string; now: Date; features: Record<string, boolean> }, contractId?: string): Promise<Omit<MapProps, 'styleUrl' | 'center' | 'ownVip'>> {
  const { features, now } = ctx;
  const storkRow = features.marta && isMarta(now) ? await storkOfDay(db, now) : null;
  const bases = features.alliance_map ? await allianceBases(db, ctx.userId) : [];
  const reports = features.road_reports ? (await activeReports(db, now, ctx.userId)).map((r) => ({ id: r.id, emoji: REPORT_KINDS[r.kind].emoji, label: REPORT_KINDS[r.kind].label, near: r.near, position: r.position })) : [];
  const fleet = await fleetView(db, ctx.companyId);
  const routeIds = fleet.vehicles.flatMap((v) => (v.delivery ? [v.delivery.routeId, v.delivery.emptyRouteId].filter((x): x is number => !!x) : []));
  const geoms = await routeGeometries(db, routeIds);
  const emptyRoutes = routeIds.length ? await db.select({ id: routes.id, fromCityId: routes.fromCityId }).from(routes).where(inArray(routes.id, routeIds)) : [];
  const fromIds = emptyRoutes.map((r) => r.fromCityId);
  const fromCities = fromIds.length ? await db.select().from(cities).where(inArray(cities.id, fromIds)) : [];
  const cityById = new Map(fromCities.map((c) => [c.id, c]));

  const vehicles: MapVehicle[] = fleet.vehicles.map((v) => {
    const d = v.delivery;
    let delivery: MapVehicle['delivery'] = null;
    if (d) {
      const loadedGeom = geoms.get(d.routeId);
      const emptyRoute = d.emptyRouteId ? emptyRoutes.find((r) => r.id === d.emptyRouteId) : null;
      const emptyFrom = emptyRoute ? cityById.get(emptyRoute.fromCityId) : null;
      delivery = {
        schedule: d.schedule,
        title: `${tx(d.contract.goods)}: ${tx(d.origin.nameBg)} → ${tx(d.destination.nameBg)}`,
        loaded: { geometry: loadedGeom?.geometry ?? null, from: [d.origin.lat, d.origin.lon], to: [d.destination.lat, d.destination.lon], km: d.loadedKm },
        empty: d.emptyRouteId && emptyFrom ? { geometry: geoms.get(d.emptyRouteId)?.geometry ?? null, from: [emptyFrom.lat, emptyFrom.lon], to: [d.origin.lat, d.origin.lon], km: d.emptyKm } : null,
      };
    }
    return { id: v.id, plate: v.plate, label: v.model.name, color: v.color, position: [v.city.lat, v.city.lon], delivery };
  });

  const depotRows = await db.select({ name: cities.nameBg, lat: cities.lat, lon: cities.lon }).from(depots).innerJoin(cities, eq(cities.id, depots.cityId)).where(eq(depots.companyId, ctx.companyId));

  let preview: MapProps['preview'] = null;
  if (contractId && /^[0-9a-f-]{36}$/.test(contractId)) {
    const [c] = await db.select().from(contracts).where(eq(contracts.id, contractId));
    if (c) {
      const [o] = await db.select().from(cities).where(eq(cities.id, c.originCityId));
      const [dd] = await db.select().from(cities).where(eq(cities.id, c.destCityId));
      const g = (await routeGeometries(db, [c.routeId])).get(c.routeId);
      preview = { title: `${tx(c.goods)}: ${tx(o!.nameBg)} → ${tx(dd!.nameBg)} · ${km(c.distanceKm)}`, approximate: g?.provider !== 'valhalla', leg: { geometry: g?.geometry ?? null, from: [o!.lat, o!.lon], to: [dd!.lat, dd!.lon], km: c.distanceKm } };
    }
  }
  // 1.2.8: snow and ice by country for the live map (the same conditions the roads have today).
  let weather: MapProps['weather'] = {};
  if (features.map_live && isSnowTime(now)) {
    const real = features.real_weather ? await realConditions(db, now) : null;
    for (const cc of GAME_COUNTRIES) {
      const c = roadCondition(cc, now, real);
      if (c !== 'clear') weather[cc] = c;
    }
  } else weather = undefined;
  return { vehicles, depots: depotRows.map((d) => ({ name: d.name, position: [d.lat, d.lon] as [number, number] })), preview, stork: storkRow ? { name: storkRow.name, position: [storkRow.lat, storkRow.lon] } : null, bases, reports, weather };
}
