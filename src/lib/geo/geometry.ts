/** Small geodesy helpers shared by server and client. Coordinates are [lat, lon]. */
export type LatLon = [number, number];

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLon, b: LatLon): number {
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function cumulativeKm(points: readonly LatLon[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1]! + haversineKm(points[i - 1]!, points[i]!));
  return out;
}

/** Point at `fraction` (0..1) of the polyline length. */
export function pointAlong(points: readonly LatLon[], fraction: number, cumulative = cumulativeKm(points)): LatLon {
  if (points.length === 0) throw new Error('empty polyline');
  if (points.length === 1) return points[0]!;
  const total = cumulative.at(-1)!;
  const target = Math.min(1, Math.max(0, fraction)) * total;
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! <= target) lo = mid;
    else hi = mid;
  }
  const span = cumulative[hi]! - cumulative[lo]!;
  const t = span > 0 ? (target - cumulative[lo]!) / span : 0;
  const a = points[lo]!;
  const b = points[hi]!;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Ramer–Douglas–Peucker simplification (tolerance in degrees, iterative). */
export function simplify(points: readonly LatLon[], tolerance: number): LatLon[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const [ax, ay] = points[start]!;
    const [bx, by] = points[end]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const [px, py] = points[i]!;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = px - (ax + t * dx);
      const ey = py - (ay + t * dy);
      const d = ex * ex + ey * ey;
      if (d > maxD) [maxD, index] = [d, i];
    }
    if (index !== -1 && maxD > tol2) {
      keep[index] = 1;
      stack.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Great-circle interpolation used only to draw clearly-labelled approximate routes. */
export function greatCircle(a: LatLon, b: LatLon, steps = 32): LatLon[] {
  return Array.from({ length: steps + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps] as LatLon);
}
