/**
 * 1.4 „Градски куриер“: a delivery van in the real centre of Sofia, Plovdiv or Varna
 * (OpenStreetMap streets, one-way streets kept). Every day each city has the same job for
 * everyone: 8 parcels on real streets, a depot and the day's traffic jams. The player taps
 * junctions; the van drives the shortest way there — by distance, like a navigator that
 * does not know about the jams — so the skill is the order of the parcels and the extra
 * taps that keep the van out of the jams. The same code replays the taps on the server.
 */
import { KIND_SPEED, type StreetGraph } from './courier-graph';
import { seeded } from './daily-route';

export const COURIER = {
  parcels: 8,
  /** Game time for the round, seconds (32 min of driving in the city). */
  limitS: 32 * 60,
  /** Each junction the van passes (lights, turns). */
  junctionS: 2,
  /** A jam makes a street this many times slower. */
  jamFactor: 4,
  jams: 9,
  jamLength: 6,
  minParcelGapM: 280,
  minFromDepotM: 300,
  maxFromDepotM: 1400,
  runsPerDay: 3,
  maxTaps: 80,
  /** Stars by parcels delivered: 4 → ★, 6 → ★★, all 8 → ★★★. */
  stars: [4, 6, 8] as const,
  xp: [0, 40, 90, 150] as const,
} as const;

export interface CourierDay { parcels: number[]; jams: Set<number> }
export interface CourierResult { delivered: number[]; timeS: number; points: number; stars: number; path: number[]; ends: number[]; done: boolean }

interface Adj { to: number; edge: number }
const adjCache = new WeakMap<StreetGraph, Adj[][]>();

/** Who can be reached from each junction (one-way streets only forward). */
export function adjacency(g: StreetGraph): Adj[][] {
  const hit = adjCache.get(g);
  if (hit) return hit;
  const adj: Adj[][] = g.nodes.map(() => []);
  g.edges.forEach(([a, b, , , oneway], i) => {
    adj[a]!.push({ to: b, edge: i });
    if (!oneway) adj[b]!.push({ to: a, edge: i });
  });
  adjCache.set(g, adj);
  return adj;
}

const dist2 = (g: StreetGraph, a: number, b: number) => {
  const [p, q] = [g.nodes[a]!, g.nodes[b]!];
  const k = Math.cos((p[0] * Math.PI) / 180);
  return ((p[0] - q[0]) * 111_320) ** 2 + ((p[1] - q[1]) * 111_320 * k) ** 2;
};
const metresBetween = (g: StreetGraph, a: number, b: number) => Math.sqrt(dist2(g, a, b));

/** The day's job in a city: the parcels (edges on named streets) and the jammed edges. */
export function courierDay(g: StreetGraph, day: string): CourierDay {
  const rand = seeded(`courier:${g.city}:${day}`);
  const adj = adjacency(g);
  // Parcels: on named streets, not trunk roads, long enough, away from the depot and from each other.
  const pool = g.edges.map((e, i) => ({ e, i })).filter(({ e }) => e[5] >= 0 && e[3] >= 2 && e[2] >= 40);
  const parcels: number[] = [];
  for (let tries = 0; parcels.length < COURIER.parcels && tries < 5000; tries++) {
    const { e, i } = pool[Math.floor(rand() * pool.length)]!;
    const far = metresBetween(g, e[0], g.depot);
    if (far < COURIER.minFromDepotM || far > COURIER.maxFromDepotM) continue;
    if (parcels.some((p) => metresBetween(g, g.edges[p]![0], e[0]) < COURIER.minParcelGapM)) continue;
    parcels.push(i);
  }
  // Jams: a few stretches of the big streets (trunk to tertiary), following the street from a start.
  const jams = new Set<number>();
  const big = g.edges.map((e, i) => ({ e, i })).filter(({ e }) => e[3] <= 3);
  for (let j = 0; j < COURIER.jams && big.length; j++) {
    let { e, i } = big[Math.floor(rand() * big.length)]!;
    for (let k = 0; k < COURIER.jamLength; k++) {
      if (parcels.includes(i)) break;
      jams.add(i);
      const next = adj[e[1]]!.find((x) => x.edge !== i && !jams.has(x.edge) && g.edges[x.edge]![5] === e[5] && g.edges[x.edge]![3] <= 3);
      if (!next) break;
      i = next.edge;
      e = g.edges[i]!;
    }
  }
  return { parcels, jams };
}

/** Seconds to drive one edge (with the day's jams) and pass its junction. */
export function edgeSeconds(g: StreetGraph, edge: number, jams: Set<number>): number {
  const [, , len, kind] = g.edges[edge]!;
  return (len / (KIND_SPEED[kind]! / 3.6)) * (jams.has(edge) ? COURIER.jamFactor : 1) + COURIER.junctionS;
}

/** The navigator's way between two junctions: shortest by distance (it does not know the jams). Edges, or null. */
export function shortestPath(g: StreetGraph, from: number, to: number): number[] | null {
  if (from === to) return [];
  const adj = adjacency(g);
  const best = new Float64Array(g.nodes.length).fill(Infinity);
  const via = new Int32Array(g.nodes.length).fill(-1);
  const done = new Uint8Array(g.nodes.length);
  best[from] = 0;
  // A binary heap of [distance, node]; ties go to the lower node, so every replay is the same.
  const heap: [number, number][] = [];
  const lt = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (x: [number, number]) => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!lt(x, heap[p]!)) break;
      heap[i] = heap[p]!;
      i = p;
    }
    heap[i] = x;
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = -1;
        if (l < heap.length && lt(heap[l]!, last)) m = l;
        if (r < heap.length && lt(heap[r]!, m === l ? heap[l]! : last)) m = r;
        if (m < 0) break;
        heap[i] = heap[m]!;
        i = m;
      }
      heap[i] = last;
    }
    return top;
  };
  push([0, from]);
  while (heap.length) {
    const [d, v] = pop();
    if (done[v]) continue;
    done[v] = 1;
    if (v === to) break;
    for (const { to: w, edge } of adj[v]!) {
      const nd = d + g.edges[edge]![2];
      if (nd < best[w]!) {
        best[w] = nd;
        via[w] = edge;
        push([nd, w]);
      }
    }
  }
  if (!Number.isFinite(best[to]!)) return null;
  const path: number[] = [];
  for (let v = to; v !== from; ) {
    const e = via[v]!;
    path.push(e);
    v = otherEnd(g, e, v);
  }
  return path.reverse();
}

const otherEnd = (g: StreetGraph, edge: number, node: number) => (g.edges[edge]![0] === node ? g.edges[edge]![1] : g.edges[edge]![0]);

/**
 * Replays the taps: from the depot to each tapped junction in turn by the navigator's way.
 * A parcel is delivered when the van drives its street; the round ends at the time limit
 * (the last stretch is cut there) or when every parcel is delivered.
 */
export function replayCourier(g: StreetGraph, day: CourierDay, taps: number[]): CourierResult {
  let at = g.depot;
  let time = 0;
  const path: number[] = [];
  const ends: number[] = [];
  const delivered: number[] = [];
  const left = new Set(day.parcels);
  outer: for (const tap of taps.slice(0, COURIER.maxTaps)) {
    if (!Number.isInteger(tap) || tap < 0 || tap >= g.nodes.length) continue;
    const way = shortestPath(g, at, tap);
    if (!way) continue;
    for (const e of way) {
      const s = edgeSeconds(g, e, day.jams);
      if (time + s > COURIER.limitS) { time = COURIER.limitS; break outer; }
      time += s;
      at = otherEnd(g, e, at);
      path.push(e);
      ends.push(at);
      if (left.delete(e)) delivered.push(e);
      if (!left.size) break outer;
    }
  }
  const done = !left.size;
  const stars = COURIER.stars.filter((n) => delivered.length >= n).length;
  // Points: 100 a parcel, and when all are in, a bonus for every second left.
  const points = delivered.length * 100 + (done ? Math.round((COURIER.limitS - time) / 3) : 0);
  return { delivered, timeS: Math.round(time), points, stars, path, ends, done };
}

/** The junction nearest to a point (for a tap on the map). */
export function nearestNode(g: StreetGraph, lat: number, lon: number): number {
  let best = 0;
  let bd = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  g.nodes.forEach(([a, b], i) => {
    const d = (a - lat) ** 2 + ((b - lon) * k) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
