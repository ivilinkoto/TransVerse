/**
 * 1.4 „Градски куриер“: builds the street graphs of the city centres from OpenStreetMap.
 *
 *   pnpm tsx scripts/geo/city-streets.ts                 → downloads from Overpass and writes src/lib/game/streets/<city>.json
 *   pnpm tsx scripts/geo/city-streets.ts --from <dir>    → reads <dir>/<city>.json (raw Overpass answers saved before)
 *
 * The raw query (per city): way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"](bbox); out body geom;
 * Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright) — the game shows the credit.
 *
 * The graph: junctions (nodes shared by two or more ways, and way ends) as nodes; the road between
 * two junctions as an edge with its length, kind, one-way flag, street name and a simplified line.
 * Only the largest strongly connected part is kept, so every junction can be reached from every other.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { COURIER_CITIES, ROAD_KINDS, type StreetGraph } from '../../src/lib/game/courier-graph';

type LatLon = [number, number];
interface Way { id: number; nodes: number[]; geometry: { lat: number; lon: number }[]; tags: Record<string, string> }

const OVERPASS = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const metres = (a: LatLon, b: LatLon) => {
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Ramer–Douglas–Peucker on a short line (degrees). */
function simplify(points: LatLon[], tol: number): LatLon[] {
  if (points.length <= 2) return points;
  const [a, b] = [points[0]!, points.at(-1)!];
  let best = -1;
  let far = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const dx = b[1] - a[1], dy = b[0] - a[0];
    const len = Math.hypot(dx, dy) || 1e-12;
    const d = Math.abs(dy * (p[1] - a[1]) - dx * (p[0] - a[0])) / len;
    if (d > far) { far = d; best = i; }
  }
  if (far <= tol) return [a, b];
  return [...simplify(points.slice(0, best + 1), tol).slice(0, -1), ...simplify(points.slice(best), tol)];
}

async function download(bbox: readonly number[]): Promise<{ elements: Way[] }> {
  const q = `[out:json][timeout:120];way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|living_street)$"](${bbox.join(',')});out body geom;`;
  const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: q }) });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return res.json() as Promise<{ elements: Way[] }>;
}

export function buildGraph(ways: Way[], bbox: readonly [number, number, number, number]): Omit<StreetGraph, 'city' | 'depot'> {
  const [s, w, n, e] = bbox;
  const inside = (p: LatLon) => p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= e;
  const uses = new Map<number, number>();
  for (const way of ways) for (const [i, id] of way.nodes.entries()) uses.set(id, (uses.get(id) ?? 0) + (i === 0 || i === way.nodes.length - 1 ? 2 : 1));
  const index = new Map<number, number>();
  const nodes: LatLon[] = [];
  const nodeOf = (id: number, p: LatLon) => {
    let k = index.get(id);
    if (k === undefined) { k = nodes.length; index.set(id, k); nodes.push([+p[0].toFixed(6), +p[1].toFixed(6)]); }
    return k;
  };
  const names: string[] = [];
  const nameOf = (nm: string | undefined) => {
    if (!nm) return -1;
    let k = names.indexOf(nm);
    if (k < 0) { k = names.length; names.push(nm); }
    return k;
  };
  type E = [number, number, number, number, number, number, number[]];
  const edges: E[] = [];
  for (const way of ways) {
    const kind = ROAD_KINDS.indexOf(way.tags.highway as (typeof ROAD_KINDS)[number]);
    if (kind < 0 || way.tags.access === 'no' || way.tags.motor_vehicle === 'no') continue;
    const ow = way.tags.oneway;
    const oneway = ow === 'yes' || ow === '1' || way.tags.junction === 'roundabout' ? 1 : ow === '-1' ? -1 : 0;
    const name = nameOf(way.tags['name:bg'] ?? way.tags.name);
    let start = 0;
    for (let i = 1; i < way.nodes.length; i++) {
      const junction = (uses.get(way.nodes[i]!) ?? 0) >= 2 || i === way.nodes.length - 1;
      if (!junction) continue;
      const from = start;
      const line: LatLon[] = way.geometry.slice(from, i + 1).map((g) => [g.lat, g.lon]);
      start = i;
      if (!line.every(inside)) continue;
      let len = 0;
      for (let k = 1; k < line.length; k++) len += metres(line[k - 1]!, line[k]!);
      if (len < 1) continue;
      let a = nodeOf(way.nodes[from]!, line[0]!);
      let b = nodeOf(way.nodes[i]!, line.at(-1)!);
      let pts = simplify(line, 0.00002).slice(1, -1);
      if (oneway === -1) { [a, b] = [b, a]; pts = pts.reverse(); }
      edges.push([a, b, Math.round(len), kind, oneway ? 1 : 0, name, pts.flatMap((p) => [+p[0].toFixed(6), +p[1].toFixed(6)])]);
    }
  }
  return keepConnected(nodes, edges, names);
}

/** Keeps the largest strongly connected part (Kosaraju, iterative) and renumbers the nodes. */
function keepConnected(nodes: LatLon[], edges: [number, number, number, number, number, number, number[]][], names: string[]) {
  const out: number[][] = nodes.map(() => []);
  const back: number[][] = nodes.map(() => []);
  for (const [a, b, , , ow] of edges) {
    out[a]!.push(b); back[b]!.push(a);
    if (!ow) { out[b]!.push(a); back[a]!.push(b); }
  }
  const seen = new Uint8Array(nodes.length);
  const order: number[] = [];
  for (let v = 0; v < nodes.length; v++) {
    if (seen[v]) continue;
    const stack: [number, number][] = [[v, 0]];
    seen[v] = 1;
    while (stack.length) {
      const top = stack.at(-1)!;
      const next = out[top[0]]![top[1]++];
      if (next === undefined) { order.push(top[0]); stack.pop(); continue; }
      if (!seen[next]) { seen[next] = 1; stack.push([next, 0]); }
    }
  }
  const comp = new Int32Array(nodes.length).fill(-1);
  let count = 0;
  const sizes: number[] = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const v = order[i]!;
    if (comp[v] !== -1) continue;
    let size = 0;
    const stack = [v];
    comp[v] = count;
    while (stack.length) {
      const x = stack.pop()!;
      size++;
      for (const y of back[x]!) if (comp[y] === -1) { comp[y] = count; stack.push(y); }
    }
    sizes.push(size);
    count++;
  }
  const big = sizes.indexOf(Math.max(...sizes));
  const map = new Map<number, number>();
  const kept: LatLon[] = [];
  nodes.forEach((p, i) => { if (comp[i] === big) { map.set(i, kept.length); kept.push(p); } });
  const keptEdges = edges.filter(([a, b]) => map.has(a) && map.has(b)).map(([a, b, ...rest]) => [map.get(a)!, map.get(b)!, ...rest] as StreetGraph['edges'][number]);
  return { nodes: kept, edges: keptEdges, names };
}

async function main() {
  const from = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null;
  mkdirSync('src/lib/game/streets', { recursive: true });
  for (const city of COURIER_CITIES) {
    const raw = from ? (JSON.parse(readFileSync(`${from}/${city.id}.json`, 'utf8')) as { elements: Way[] }) : await download(city.bbox);
    const g = buildGraph(raw.elements.filter((x) => (x as { type?: string }).type !== 'node'), city.bbox);
    // The depot: the junction nearest to the city's centre.
    let depot = 0;
    g.nodes.forEach((p, i) => { if (metres(p, city.centre) < metres(g.nodes[depot]!, city.centre)) depot = i; });
    const graph: StreetGraph = { city: city.id, depot, ...g };
    writeFileSync(`src/lib/game/streets/${city.id}.json`, JSON.stringify(graph));
    console.log(`${city.id}: ${g.nodes.length} junctions, ${g.edges.length} roads, ${g.names.length} street names`);
  }
}

if (process.argv[1]?.endsWith('city-streets.ts')) void main();
