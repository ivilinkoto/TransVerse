/**
 * Company analytics: what the finished deliveries of a period earned, per
 * truck, driver, lane and cargo. Pure aggregation (the server loads the rows);
 * all money values are the ones the server settled.
 */

export interface DeliveryRow {
  id: string;
  completedAt: Date;
  vehicleId: string;
  driverId: string;
  coDriverId: string | null;
  originCityId: number;
  destCityId: number;
  cargoType: string;
  emptyKm: number;
  loadedKm: number;
  tons: number;
  rewardCents: number;
  /** Net result of the trip (reward, bonuses, costs, penalties, company share). */
  payoutCents: number;
  late: boolean;
  fuelLitres: number;
  fuelCents: number;
}

export interface Group {
  key: string;
  trips: number;
  km: number;
  netCents: number;
  onTime: number;
}

export interface Analytics {
  trips: number;
  km: number;
  loadedKm: number;
  tons: number;
  revenueCents: number;
  netCents: number;
  onTimeShare: number;
  netPerKmCents: number;
  litresPer100: number;
  fuelCentsPerKm: number;
  daily: { day: string; netCents: number; trips: number }[];
  vehicles: Group[];
  drivers: Group[];
  lanes: Group[];
  cargo: Group[];
}

const sofiaDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(d);

function groupBy(rows: DeliveryRow[], keys: (r: DeliveryRow) => string[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    for (const key of keys(r)) {
      const g = map.get(key) ?? { key, trips: 0, km: 0, netCents: 0, onTime: 0 };
      g.trips++;
      g.km += r.emptyKm + r.loadedKm;
      g.netCents += r.payoutCents;
      g.onTime += r.late ? 0 : 1;
      map.set(key, g);
    }
  }
  return [...map.values()].sort((a, b) => b.netCents - a.netCents);
}

/** Aggregates the deliveries finished in [from, to); `days` gives one row per day even without trips. */
export function analyze(rows: DeliveryRow[], from: Date, days: number): Analytics {
  const km = rows.reduce((s, r) => s + r.emptyKm + r.loadedKm, 0);
  const net = rows.reduce((s, r) => s + r.payoutCents, 0);
  const litres = rows.reduce((s, r) => s + r.fuelLitres, 0);
  const fuel = rows.reduce((s, r) => s + r.fuelCents, 0);
  const byDay = new Map<string, { netCents: number; trips: number }>();
  for (let i = 0; i < days; i++) byDay.set(sofiaDay(new Date(from.getTime() + i * 86_400_000 + 43_200_000)), { netCents: 0, trips: 0 });
  for (const r of rows) {
    const d = byDay.get(sofiaDay(r.completedAt));
    if (d) {
      d.netCents += r.payoutCents;
      d.trips++;
    }
  }
  return {
    trips: rows.length,
    km,
    loadedKm: rows.reduce((s, r) => s + r.loadedKm, 0),
    tons: rows.reduce((s, r) => s + r.tons, 0),
    revenueCents: rows.reduce((s, r) => s + r.rewardCents, 0),
    netCents: net,
    onTimeShare: rows.length ? rows.filter((r) => !r.late).length / rows.length : 0,
    netPerKmCents: km > 0 ? net / km : 0,
    litresPer100: km > 0 ? (litres / km) * 100 : 0,
    fuelCentsPerKm: km > 0 ? fuel / km : 0,
    daily: [...byDay.entries()].map(([day, v]) => ({ day, ...v })),
    vehicles: groupBy(rows, (r) => [r.vehicleId]),
    // A team trip counts for both drivers.
    drivers: groupBy(rows, (r) => (r.coDriverId ? [r.driverId, r.coDriverId] : [r.driverId])),
    lanes: groupBy(rows, (r) => [`${r.originCityId}>${r.destCityId}`]),
    cargo: groupBy(rows, (r) => [r.cargoType]),
  };
}
