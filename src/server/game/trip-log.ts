import polyline from '@mapbox/polyline';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { tripStats } from '@/lib/game/trip-log';
import type { Segment } from '@/lib/game/schedule';
import { simplify, type LatLon } from '@/lib/geo/geometry';
import type { Database, DbOrTx } from '@/server/db/client';
import { cities, companies, contracts, deliveries, ledgerEntries, routes, users, vehicles } from '@/server/db/schema';
import { fail } from './errors';
import { t } from '@/i18n/t';

/** The finished trips of a player (newest first). */
export async function tripsOf(db: DbOrTx, userId: string, limit = 30) {
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!account) return [];
  const rows = await db
    .select({ id: deliveries.id, completedAt: deliveries.completedAt, late: deliveries.late, payoutCents: deliveries.payoutCents, loadedKm: deliveries.loadedKm, emptyKm: deliveries.emptyKm, goods: contracts.goods, originCityId: contracts.originCityId, destCityId: contracts.destCityId, sharedAt: deliveries.sharedAt })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(and(eq(deliveries.companyId, account.id), eq(deliveries.status, 'completed'), isNotNull(deliveries.completedAt)))
    .orderBy(desc(deliveries.completedAt))
    .limit(limit);
  const names = rows.length ? await db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, [...new Set(rows.flatMap((r) => [r.originCityId, r.destCityId]))])) : [];
  const name = (id: number) => names.find((c) => c.id === id)?.nameBg ?? '';
  return rows.map((r) => ({ ...r, from: name(r.originCityId), to: name(r.destCityId) }));
}

/** One finished trip, everything the log shows. `publicOnly`: only when its player shared it. */
export async function tripLog(db: DbOrTx, id: string, viewer: { userId: string } | { publicOnly: true }) {
  const [row] = await db
    .select({ d: deliveries, c: contracts, ownerId: companies.ownerId, username: users.username, plate: vehicles.plate, modelId: vehicles.modelId })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .innerJoin(users, eq(users.id, companies.ownerId))
    .leftJoin(vehicles, eq(vehicles.id, deliveries.vehicleId))
    .where(and(eq(deliveries.id, id), eq(deliveries.status, 'completed')));
  if (!row) return null;
  if ('publicOnly' in viewer ? !row.d.sharedAt : row.ownerId !== viewer.userId) return null;
  const [route] = await db.select({ geometry: routes.geometry, countries: routes.countries }).from(routes).where(eq(routes.id, row.c.routeId));
  const ends = await db.select({ id: cities.id, nameBg: cities.nameBg, lat: cities.lat, lon: cities.lon }).from(cities).where(inArray(cities.id, [row.c.originCityId, row.c.destCityId]));
  const from = ends.find((e) => e.id === row.c.originCityId)!;
  const to = ends.find((e) => e.id === row.c.destCityId)!;
  const points: LatLon[] = route?.geometry ? simplify(polyline.decode(route.geometry, 6) as LatLon[], 0.02) : [[from.lat, from.lon], [to.lat, to.lon]];
  const km = row.d.loadedKm + row.d.emptyKm;
  const ledger = 'publicOnly' in viewer ? [] : await db.select({ category: ledgerEntries.category, amountCents: ledgerEntries.amountCents, description: ledgerEntries.description }).from(ledgerEntries).where(and(eq(ledgerEntries.refType, 'delivery'), eq(ledgerEntries.refId, id)));
  return {
    id,
    username: row.username,
    plate: row.plate,
    modelId: row.modelId,
    goods: row.c.goods,
    tons: row.c.weightTons,
    from: from.nameBg,
    to: to.nameBg,
    countries: route?.countries ?? [],
    startedAt: row.d.startedAt,
    completedAt: row.d.completedAt!,
    late: !!row.d.late,
    km,
    payoutCents: row.d.payoutCents ?? 0,
    xp: row.d.xpAwarded ?? 0,
    events: (row.d.roadEvents ?? []).length,
    convoy: !!row.d.organizedConvoyId || !!row.d.convoyWith,
    stats: tripStats(row.d.schedule as Segment[], km),
    points,
    ledger,
    sharedAt: row.d.sharedAt,
    reefer: row.d.reefer,
  };
}

/** The player shares a trip: a public page and a card for social networks. */
export async function shareTrip(db: Database, userId: string, id: string, on = true) {
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  const [row] = await db.update(deliveries).set({ sharedAt: on ? new Date() : null }).where(and(eq(deliveries.id, id), eq(deliveries.companyId, account?.id ?? ''), eq(deliveries.status, 'completed'))).returning({ id: deliveries.id });
  if (!row) fail('not_found', t('Няма такъв курс.'), 404);
  return { shared: on };
}
