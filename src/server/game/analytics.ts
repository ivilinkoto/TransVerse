import { and, eq, gte, inArray } from 'drizzle-orm';
import { analyze, type DeliveryRow } from '@/lib/game/analytics';
import type { TripCosts } from '@/lib/game/economy';
import type { DbOrTx } from '@/server/db/client';
import { cities, contracts, deliveries, drivers, vehicles } from '@/server/db/schema';
import { tx } from '@/i18n/t';

/** The company's analytics for the last `days` days (finished deliveries), with names for the groups. */
export async function companyAnalytics(db: DbOrTx, companyId: string, days: number, now: Date) {
  const from = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .select({ d: deliveries, c: { originCityId: contracts.originCityId, destCityId: contracts.destCityId, cargoType: contracts.cargoType, weightTons: contracts.weightTons, rewardCents: contracts.rewardCents } })
    .from(deliveries)
    .innerJoin(contracts, eq(contracts.id, deliveries.contractId))
    .where(and(eq(deliveries.companyId, companyId), eq(deliveries.status, 'completed'), gte(deliveries.completedAt, from)));
  const input: DeliveryRow[] = rows.map(({ d, c }) => {
    const costs = d.estimatedCosts as TripCosts;
    return {
      id: d.id,
      completedAt: d.completedAt!,
      vehicleId: d.vehicleId,
      driverId: d.driverId,
      coDriverId: d.coDriverId,
      originCityId: c.originCityId,
      destCityId: c.destCityId,
      cargoType: c.cargoType,
      emptyKm: d.emptyKm,
      loadedKm: d.loadedKm,
      tons: c.weightTons,
      rewardCents: c.rewardCents,
      payoutCents: d.payoutCents ?? 0,
      late: !!d.late,
      // Rented trucks pay a fee instead of fuel: their fuel is not counted.
      fuelLitres: costs.fuelLitres ?? 0,
      fuelCents: costs.fuelCents ?? 0,
    };
  });
  const result = analyze(input, from, days);
  const vehicleIds = result.vehicles.map((g) => g.key);
  const driverIds = result.drivers.map((g) => g.key);
  const cityIds = [...new Set(input.flatMap((r) => [r.originCityId, r.destCityId]))];
  const [vRows, dRows, cRows] = await Promise.all([
    vehicleIds.length ? db.select({ id: vehicles.id, plate: vehicles.plate, modelId: vehicles.modelId, soldAt: vehicles.soldAt }).from(vehicles).where(inArray(vehicles.id, vehicleIds)) : [],
    driverIds.length ? db.select({ id: drivers.id, name: drivers.name }).from(drivers).where(inArray(drivers.id, driverIds)) : [],
    cityIds.length ? db.select({ id: cities.id, nameBg: cities.nameBg }).from(cities).where(inArray(cities.id, cityIds)) : [],
  ]);
  const city = (id: number) => cRows.find((c) => c.id === id)?.nameBg ?? '—';
  return {
    ...result,
    names: {
      vehicle: Object.fromEntries(vRows.map((v) => [v.id, { plate: v.plate, modelId: v.modelId, sold: !!v.soldAt }])),
      driver: Object.fromEntries(dRows.map((d) => [d.id, d.name])) as Record<string, string>,
      lane: Object.fromEntries(result.lanes.map((l) => {
        const [a, b] = l.key.split('>').map(Number);
        return [l.key, `${tx(city(a!))} → ${tx(city(b!))}`];
      })) as Record<string, string>,
    },
  };
}
