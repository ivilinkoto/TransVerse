import { eq, inArray } from 'drizzle-orm';
import { PageHeader } from '@/components/ui';
import type { MapProps, MapVehicle } from '@/components/game/WorldMap';
import { km } from '@/lib/format';
import { cities, contracts, depots, routes } from '@/server/db/schema';
import { TutorialVisit } from '@/components/game/TutorialVisit';
import { gameContext } from '@/server/game/context';
import { tutorialPending } from '@/server/game/tutorial-flags';
import { fleetView, routeGeometries } from '@/server/game/queries';
import { MapClient } from './MapClient';
import { isVip } from '@/lib/game/vip';
import { isMarta } from '@/lib/game/marta';
import { storkOfDay } from '@/server/game/marta';
import { allianceBases } from '@/server/game/alliances';

export const metadata = { title: 'Карта' };

export default async function MapPage({ searchParams }: { searchParams: Promise<{ contract?: string }> }) {
  const { db, user, company, hq, now, features } = await gameContext();
  // Баба Марта (v1.5): the stork of the day.
  const storkRow = features.marta && isMarta(now) ? await storkOfDay(db, now) : null;
  const bases = features.alliance_map ? await allianceBases(db, user.id) : [];
  const fleet = await fleetView(db, company.id);
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
        title: `${d.contract.goods}: ${d.origin.nameBg} → ${d.destination.nameBg}`,
        loaded: { geometry: loadedGeom?.geometry ?? null, from: [d.origin.lat, d.origin.lon], to: [d.destination.lat, d.destination.lon], km: d.loadedKm },
        empty: d.emptyRouteId && emptyFrom ? { geometry: geoms.get(d.emptyRouteId)?.geometry ?? null, from: [emptyFrom.lat, emptyFrom.lon], to: [d.origin.lat, d.origin.lon], km: d.emptyKm } : null,
      };
    }
    return { id: v.id, plate: v.plate, label: v.model.name, color: v.color, position: [v.city.lat, v.city.lon], delivery };
  });

  const depotRows = await db.select({ name: cities.nameBg, lat: cities.lat, lon: cities.lon }).from(depots).innerJoin(cities, eq(cities.id, depots.cityId)).where(eq(depots.companyId, company.id));

  let preview: MapProps['preview'] = null;
  const contractId = (await searchParams).contract;
  if (contractId && /^[0-9a-f-]{36}$/.test(contractId)) {
    const c = await db.query.contracts.findFirst({ where: eq(contracts.id, contractId) });
    if (c) {
      const [o] = await db.select().from(cities).where(eq(cities.id, c.originCityId));
      const [dd] = await db.select().from(cities).where(eq(cities.id, c.destCityId));
      const g = (await routeGeometries(db, [c.routeId])).get(c.routeId);
      preview = { title: `${c.goods}: ${o!.nameBg} → ${dd!.nameBg} · ${km(c.distanceKm)}`, approximate: g?.provider !== 'valhalla', leg: { geometry: g?.geometry ?? null, from: [o!.lat, o!.lon], to: [dd!.lat, dd!.lon], km: c.distanceKm } };
    }
  }

  const visitPending = await tutorialPending(db, user.id, 'track_map');
  return (
    <div>
      <TutorialVisit step="track_map" pending={visitPending} />
      <PageHeader
        title="Карта"
        subtitle={preview ? `Преглед на маршрут — ${preview.title}${preview.approximate ? ' (приблизителна линия, пътният маршрут не е наличен)' : ' (реален пътен маршрут за камион)'}` : 'Твоите камиони и тези на всички играчи — на живо, по реални пътища.'}
      />
      <MapClient ownVip={isVip(user.vipUntil, (await gameContext()).now)} styleUrl={process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? 'https://tiles.openfreemap.org/styles/dark'} center={[hq.lat, hq.lon]} vehicles={vehicles} depots={depotRows.map((d) => ({ name: d.name, position: [d.lat, d.lon] }))} preview={preview} stork={storkRow ? { name: storkRow.name, position: [storkRow.lat, storkRow.lon] } : null} bases={bases} />
    </div>
  );
}
