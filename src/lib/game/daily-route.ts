/**
 * 1.3 „Пътят на деня“: a daily puzzle, the same for everybody — six real cities,
 * the first one fixed as the start; put the other five in the order that makes
 * the shortest path (straight-line distances between the real coordinates,
 * not road routes). Three tries; the best one counts. Game data.
 */
export const DAILY_ROUTE = {
  cities: 6,
  tries: 3,
  /** Cities this big or bigger, in the countries open to everybody that day. */
  minPopulation: 150_000,
  /** The other cities lie this far from the start (km, straight line)... */
  near: [120, 900] as const,
  /** ...and at least this far from each other. */
  apart: 60,
  /** Rewards (once a day): from 90% of the best path, and the best path itself. */
  rewards: { good: { pct: 90, cents: 500_00 }, perfect: { pct: 100, cents: 500_00 } },
} as const;

export interface RouteCity { id: number; name: string; country: string; lat: number; lon: number }

/** Great-circle distance in km. */
export function crowKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The length of a path through the cities in this order (ids). */
export function pathKm(cities: RouteCity[], order: number[]): number {
  const by = new Map(cities.map((c) => [c.id, c]));
  let km = 0;
  for (let i = 1; i < order.length; i++) km += crowKm(by.get(order[i - 1]!)!, by.get(order[i]!)!);
  return km;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/** The shortest order from the first city through all the others. */
export function bestOrder(cities: RouteCity[]): { order: number[]; km: number } {
  const [start, ...rest] = cities;
  let best = { order: [] as number[], km: Infinity };
  for (const p of permutations(rest.map((c) => c.id))) {
    const order = [start!.id, ...p];
    const km = pathKm(cities, order);
    if (km < best.km - 1e-9) best = { order, km };
  }
  return best;
}

/** A guess is a full order: the start first, then each other city once. */
export function validOrder(cities: RouteCity[], order: number[]): boolean {
  if (order.length !== cities.length || order[0] !== cities[0]!.id) return false;
  const ids = new Set(cities.map((c) => c.id));
  return new Set(order).size === order.length && order.every((id) => ids.has(id));
}

/** How good a path is: the best length as a percent of this one (100 = the best). */
export function routeScore(bestKm: number, km: number): number {
  return km <= bestKm + 0.5 ? 100 : Math.floor((bestKm / km) * 1000) / 10;
}

/** A small seeded generator (the day's puzzle must be the same for everybody). */
export function seeded(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
}

/** Picks the day's six cities from the pool (sorted by id, so the pick is stable). */
export function pickCities(pool: RouteCity[], day: string): RouteCity[] | null {
  const rand = seeded(`daily-route:${day}`);
  const sorted = [...pool].sort((a, b) => a.id - b.id);
  for (let attempt = 0; attempt < 40 && sorted.length >= DAILY_ROUTE.cities; attempt++) {
    const start = sorted[Math.floor(rand() * sorted.length)]!;
    const near = sorted.filter((c) => c.id !== start.id && crowKm(start, c) >= DAILY_ROUTE.near[0] && crowKm(start, c) <= DAILY_ROUTE.near[1]);
    const picked: RouteCity[] = [start];
    const left = [...near];
    while (picked.length < DAILY_ROUTE.cities && left.length) {
      const c = left.splice(Math.floor(rand() * left.length), 1)[0]!;
      if (picked.every((p) => crowKm(p, c) >= DAILY_ROUTE.apart)) picked.push(c);
    }
    if (picked.length === DAILY_ROUTE.cities) return picked;
  }
  return null;
}

/** The squares for sharing: 🟩 a city in the same place as in the best path, 🟨 elsewhere. */
export function shareSquares(best: number[], order: number[]): string {
  return order.slice(1).map((id, i) => (best[i + 1] === id ? '🟩' : '🟨')).join('');
}
