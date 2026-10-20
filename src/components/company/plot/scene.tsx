/**
 * The company plot drawn in isometric view, in daylight: lawn, driveway,
 * fence and gate, the street outside, trees, lamps, the buildings (each type
 * and level its own illustration), construction sites with a crane, and the
 * ghost of a building being placed. 1 tile = one grid square of the plot.
 * Pure drawing — no state.
 */
import type { ReactNode } from 'react';
import { BUILDINGS, PLOT, type BuildingType, type MaterialId } from '@/lib/game/plot';

export const TILE = 40;
const C = Math.cos(Math.PI / 6);
/** Scene origin (screen position of tile 0,0 at ground level) and size of the drawing. */
export const ORIGIN = { x: 560, y: 250 };
/** The part of the drawing shown at zoom 1: the plot with the street in front. */
export const VIEW = { x: 60, y: 40, w: 1080, h: 780 };

export const P = (x: number, y: number, z = 0): [number, number] => [ORIGIN.x + (x - y) * C * TILE, ORIGIN.y + (x + y) * 0.5 * TILE - z * TILE];
/** Plot coordinates (fractional tiles) under a point of the drawing. */
export function toTile(sx: number, sy: number) {
  const u = (sx - ORIGIN.x) / (C * TILE);
  const v = (sy - ORIGIN.y) / (0.5 * TILE);
  return { x: (u + v) / 2, y: (v - u) / 2 };
}

type Pt = [number, number, number];
const pts = (a: Pt[]) => a.map(([x, y, z]) => P(x, y, z).map((n) => n.toFixed(1)).join(',')).join(' ');
interface Faces {
  top: string;
  left: string;
  right: string;
}

let uid = 0;
const k = () => `e${uid++}`;

function Poly({ p, fill, ...rest }: { p: Pt[]; fill: string } & React.SVGProps<SVGPolygonElement>) {
  return <polygon points={pts(p)} fill={fill} {...rest} />;
}
function Line({ a, b, stroke, w = 1, ...rest }: { a: Pt; b: Pt; stroke: string; w?: number } & React.SVGProps<SVGLineElement>) {
  const [x1, y1] = P(...a);
  const [x2, y2] = P(...b);
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={w} strokeLinecap="round" {...rest} />;
}
/** An extruded box: the left-front (y = y1), right-front (x = x1) and top faces. */
function box(x0: number, y0: number, x1: number, y1: number, z0: number, h: number, c: Faces, extra: React.SVGProps<SVGPolygonElement> = {}): ReactNode {
  const z1 = z0 + h;
  return (
    <g key={k()}>
      <Poly p={[[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]} fill={c.left} {...extra} />
      <Poly p={[[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]} fill={c.right} {...extra} />
      <Poly p={[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]} fill={c.top} {...extra} />
    </g>
  );
}
const flat = (x0: number, y0: number, x1: number, y1: number, z: number, fill: string, extra: React.SVGProps<SVGPolygonElement> = {}) => <Poly key={k()} p={[[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]} fill={fill} {...extra} />;
const onY = (y: number, xa: number, xb: number, za: number, zb: number, fill: string, extra: React.SVGProps<SVGPolygonElement> = {}) => <Poly key={k()} p={[[xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb]]} fill={fill} {...extra} />;
const onX = (x: number, ya: number, yb: number, za: number, zb: number, fill: string, extra: React.SVGProps<SVGPolygonElement> = {}) => <Poly key={k()} p={[[x, ya, za], [x, yb, za], [x, yb, zb], [x, ya, zb]]} fill={fill} {...extra} />;
/** Soft shadow of a block on the lawn (sun from the upper left). */
const shadow = (x0: number, y0: number, x1: number, y1: number, h: number) => <Poly key={k()} p={[[x0, y1, 0.05], [x1, y1, 0.05], [x1 + h * 0.55, y1 - h * 0.15, 0.05], [x1 + h * 0.55, y0 - h * 0.15, 0.05], [x1, y0, 0.05]]} fill="rgba(20,40,25,0.28)" />;

const shade = (base: [number, number, number], f: number) => `rgb(${base.map((v) => Math.round(Math.min(255, v * f))).join(',')})`;
const faces = (rgb: [number, number, number]): Faces => ({ top: shade(rgb, 1.12), left: shade(rgb, 0.95), right: shade(rgb, 0.78) });

// ── Vehicles ─────────────────────────────────────────────────────────────
/** A truck along y: an articulated one (length 4.2) or, with `rigid`, a box truck that fits a parking bay (2.6). */
function truck(x: number, y: number, cab: [number, number, number], trailer: [number, number, number], rigid = false) {
  const body = rigid ? 1.7 : 3.2;
  const wheel = (xx: number, yy: number) => {
    const [cx, cy] = P(xx, yy, 0.18);
    return <ellipse key={k()} cx={cx} cy={cy} rx={5} ry={6.5} fill="#1d1f24" stroke="#5b6170" strokeWidth={1} />;
  };
  return (
    <g key={k()}>
      {shadow(x, y, x + 0.9, y + body + 1, 1.2)}
      {box(x, y, x + 0.9, y + body, 0.25, 1.15, faces(trailer))}
      {box(x + 0.05, y + body + 0.1, x + 0.85, y + body + 1, 0.25, 1.05, faces(cab))}
      {onY(y + body + 1, x + 0.15, x + 0.75, 0.75, 1.15, '#bfe3ff')}
      {onY(y + body + 1, x + 0.1, x + 0.8, 0.25, 0.4, '#2b2f37')}
      {wheel(x + 0.9, y + 0.4)}
      {!rigid && wheel(x + 0.9, y + 1.0)}
      {wheel(x + 0.9, y + body + 0.5)}
    </g>
  );
}
function car(x: number, y: number, rgb: [number, number, number], alongX = true) {
  return alongX ? (
    <g key={k()}>{box(x, y, x + 1.3, y + 0.6, 0.15, 0.45, faces(rgb))}{box(x + 0.3, y + 0.05, x + 1.0, y + 0.55, 0.6, 0.3, faces([170, 215, 245]))}</g>
  ) : (
    <g key={k()}>{box(x, y, x + 0.6, y + 1.3, 0.15, 0.45, faces(rgb))}{box(x + 0.05, y + 0.3, x + 0.55, y + 1.0, 0.6, 0.3, faces([170, 215, 245]))}</g>
  );
}

// ── Nature ───────────────────────────────────────────────────────────────
function tree(x: number, y: number, r = 0.55, v = 0) {
  const [tx, ty] = P(x, y, 0);
  const [cx, cy] = P(x, y, 1.2);
  const greens = ['#3f9a4f', '#358a45', '#4caa5a'];
  return (
    <g key={k()}>
      <ellipse cx={tx + 10} cy={ty + 2} rx={r * TILE} ry={r * TILE * 0.45} fill="rgba(20,40,25,0.25)" />
      <rect x={tx - 2.5} y={cy} width={5} height={ty - cy} fill="#7a5235" />
      <circle cx={cx} cy={cy} r={r * TILE} fill={greens[v % 3]} />
      <circle cx={cx - r * TILE * 0.32} cy={cy - r * TILE * 0.35} r={r * TILE * 0.55} fill="#6cc977" opacity={0.6} />
    </g>
  );
}
function bush(x: number, y: number) {
  const [cx, cy] = P(x, y, 0.25);
  return (
    <g key={k()}>
      <ellipse cx={cx} cy={cy} rx={11} ry={7} fill="#3f9a4f" />
      <ellipse cx={cx - 3} cy={cy - 3} rx={6} ry={4} fill="#73cf7e" opacity={0.7} />
    </g>
  );
}
function lamp(x: number, y: number) {
  const [bx, by] = P(x, y, 0);
  const [tx, ty] = P(x, y, 1.6);
  return (
    <g key={k()}>
      <line x1={bx} y1={by} x2={tx} y2={ty} stroke="#5e6676" strokeWidth={1.8} />
      <rect x={tx - 5} y={ty - 2} width={10} height={4} rx={2} fill="#4a5160" />
    </g>
  );
}

// ── Buildings ────────────────────────────────────────────────────────────
interface Footprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Height of a finished building of this type and level (tiles). */
export function buildingHeight(type: BuildingType, level: number) {
  switch (type) {
    case 'office':
      return 0.5 + (1 + Math.max(1, level)) * 0.95;
    case 'logistics':
      return 2.0 + level * 0.1;
    case 'training':
      return 2.2 + (level >= 3 ? 1 : 0);
    case 'service':
      return 1.7;
    case 'parking':
      return 0.05;
  }
}

function office(f: Footprint, level: number) {
  const x0 = f.x + 0.2, y0 = f.y + 0.2, x1 = f.x + f.w - 0.3, y1 = f.y + f.h - 0.2;
  const floors = 1 + Math.max(1, level);
  const h = buildingHeight('office', level);
  const out: ReactNode[] = [shadow(x0, y0, x1, y1, h), box(x0, y0, x1, y1, 0, h, { top: '#e9eef4', left: '#c7d1de', right: '#a5b2c4' })];
  for (let fl = 0; fl < floors; fl++) {
    const za = 0.35 + fl * 0.95, zb = za + 0.62;
    for (let x = x0 + 0.15; x < x1 - 0.2; x += 0.5) out.push(onY(y1, x, x + 0.38, za, zb, (Math.round(x * 3) + fl) % 4 === 0 ? '#bfe3fb' : '#5fa8d9'));
    for (let y = y0 + 0.15; y < y1 - 0.2; y += 0.5) out.push(onX(x1, y, y + 0.38, za, zb, (Math.round(y * 3) + fl) % 4 === 1 ? '#9fd0f0' : '#3f86bb'));
  }
  // Entrance with a canopy, the company colour band and roof equipment.
  const mid = (y0 + y1) / 2;
  out.push(onX(x1, mid - 0.35, mid + 0.35, 0, 0.75, '#2c4a66'));
  out.push(box(x1, mid - 0.55, x1 + 0.45, mid + 0.55, 0.8, 0.1, { top: '#ffffff', left: '#dfe5ec', right: '#c3ccd8' }));
  out.push(box(x0, y1 - 0.12, x1, y1, h - 0.18, 0.18, { top: '#22d3ee', left: '#22c1da', right: '#1a9fb5' }));
  out.push(box(x0 + 0.3, y0 + 0.3, x0 + 1.0, y0 + 0.9, h, 0.3, faces([150, 160, 172])));
  out.push(box(x0 + 1.3, y0 + 0.35, x0 + 1.8, y0 + 0.85, h, 0.22, faces([150, 160, 172])));
  return out;
}

function logistics(f: Footprint, level: number) {
  const x0 = f.x + 0.15, y0 = f.y + 0.15, x1 = f.x + f.w - 0.2, y1 = f.y + f.h - 0.5;
  const h = buildingHeight('logistics', level);
  const out: ReactNode[] = [shadow(x0, y0, x1, y1, h), box(x0, y0, x1, y1, 0, h, { top: '#d9dee6', left: '#b9c2cf', right: '#98a3b3' })];
  // Ribbed cladding and skylights.
  for (let x = x0 + 0.2; x < x1; x += 0.25) out.push(<Line key={k()} a={[x, y1, 0.05]} b={[x, y1, h - 0.05]} stroke="#a7b1bf" w={0.8} />);
  for (let x = x0 + 0.5; x < x1 - 0.4; x += 0.9) out.push(<Poly key={k()} p={[[x, y0 + 0.5, h + 0.01], [x + 0.4, y0 + 0.5, h + 0.01], [x + 0.4, y1 - 0.5, h + 0.01], [x, y1 - 0.5, h + 0.01]]} fill="#9cc9e6" />);
  // Loading docks on the yard side, a trailer at some.
  const docks = Math.min(5, 1 + level);
  const step = (x1 - x0 - 0.3) / docks;
  for (let i = 0; i < docks; i++) {
    const xa = x0 + 0.2 + i * step;
    out.push(onY(y1, xa, xa + step * 0.7, 0.1, 1.15, '#4c5566'));
    out.push(onY(y1, xa, xa + step * 0.7, 1.15, 1.3, '#f6c343'));
  }
  // A glass office corner.
  out.push(box(x1 - 1.0, y1 - 0.6, x1 + 0.05, y1 + 0.05, 0, h + 0.4, { top: '#e9eef4', left: '#5fa8d9', right: '#3f86bb' }));
  return out;
}

function training(f: Footprint, level: number) {
  const x0 = f.x + 0.25, y0 = f.y + 0.25, x1 = f.x + f.w - 0.3, y1 = f.y + f.h - 0.3;
  const h = buildingHeight('training', level);
  const out: ReactNode[] = [shadow(x0, y0, x1, y1, h), box(x0, y0, x1, y1, 0, h, { top: '#e8d2b8', left: '#c9824f', right: '#a96a3f' })];
  const rows = h > 3 ? 3 : 2;
  for (let r = 0; r < rows; r++) {
    const za = 0.35 + r * 1.0, zb = za + 0.6;
    for (let x = x0 + 0.2; x < x1 - 0.2; x += 0.65) out.push(onY(y1, x, x + 0.5, za, zb, '#f3f6fa'), onY(y1, x + 0.05, x + 0.45, za + 0.05, zb - 0.05, '#6fb1dc'));
    for (let y = y0 + 0.2; y < y1 - 0.2; y += 0.65) out.push(onX(x1, y, y + 0.5, za, zb, '#4b8fbf'));
  }
  // A sloped roof and a flag.
  const ridge = h + 0.6;
  out.push(<Poly key={k()} p={[[x0, y1, h], [x1, y1, h], [x1, (y0 + y1) / 2, ridge], [x0, (y0 + y1) / 2, ridge]]} fill="#7e4a3a" />);
  out.push(<Poly key={k()} p={[[x1, y0, h], [x1, y1, h], [x1, (y0 + y1) / 2, ridge]]} fill="#6a3d30" />);
  out.push(<Line key={k()} a={[x1 + 0.4, y1 + 0.3, 0]} b={[x1 + 0.4, y1 + 0.3, 2.6]} stroke="#8d97a8" w={1.5} />);
  out.push(<Poly key={k()} p={[[x1 + 0.4, y1 + 0.3, 2.6], [x1 + 0.4, y1 + 1.0, 2.6], [x1 + 0.4, y1 + 1.0, 2.25], [x1 + 0.4, y1 + 0.3, 2.25]]} fill="#22d3ee" />);
  return out;
}

function service(f: Footprint, level: number) {
  const x0 = f.x + 0.2, y0 = f.y + 0.2, x1 = f.x + f.w - 0.25, y1 = f.y + f.h - 0.45;
  const h = buildingHeight('service', level);
  const out: ReactNode[] = [shadow(x0, y0, x1, y1, h), box(x0, y0, x1, y1, 0, h, { top: '#e3e7ec', left: '#d6dbe2', right: '#b4bcc8' })];
  const doors = Math.min(3, level + 1);
  const step = (x1 - x0 - 0.2) / doors;
  for (let i = 0; i < doors; i++) {
    const xa = x0 + 0.15 + i * step;
    out.push(onY(y1, xa, xa + step * 0.8, 0.05, 1.1, '#8e99aa'));
    for (let z = 0.15; z < 1.1; z += 0.12) out.push(<Line key={k()} a={[xa, y1, z]} b={[xa + step * 0.8, y1, z]} stroke="#a9b3c2" w={0.7} />);
  }
  out.push(box(x0, y1 - 0.1, x1, y1, h - 0.35, 0.3, { top: '#e04545', left: '#e04545', right: '#b83434' }));
  // Tyres stacked by the wall.
  for (let i = 0; i < 3; i++) {
    const [cx, cy] = P(x1 + 0.35, y1 - 0.4, 0.12 + i * 0.16);
    out.push(<ellipse key={k()} cx={cx} cy={cy} rx={9} ry={4.5} fill="#2b2f37" stroke="#4a505c" />);
  }
  return out;
}

function parking(f: Footprint, level: number, trucks: number) {
  const x0 = f.x + 0.1, y0 = f.y + 0.1, x1 = f.x + f.w - 0.1, y1 = f.y + f.h - 0.1;
  const out: ReactNode[] = [flat(x0, y0, x1, y1, 0.04, '#6b717c'), flat(x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 0.05, 0.045, '#5d636e')];
  const bays = Math.max(3, Math.min(Math.floor((x1 - x0) / 1.2), 2 + level));
  const step = (x1 - x0) / bays;
  for (let i = 0; i <= bays; i++) out.push(flat(x0 + i * step, y0 + 0.2, x0 + i * step + 0.06, y1 - 0.2, 0.05, '#f2f0e4'));
  const colors: [number, number, number][] = [[47, 123, 255], [246, 195, 67], [166, 107, 255], [47, 210, 122], [224, 69, 69]];
  for (let i = 0; i < Math.min(trucks, bays); i++) out.push(truck(x0 + i * step + (step - 0.9) / 2, y0 + 0.2, [235, 240, 246], colors[i % colors.length]!, true));
  // Ticket booth and a light pole.
  out.push(box(x1 - 0.5, y1 - 0.5, x1 - 0.1, y1 - 0.1, 0.05, 0.8, faces([226, 232, 240])));
  out.push(lamp(x0 + 0.2, y1 - 0.2));
  return out;
}

// ── Construction ─────────────────────────────────────────────────────────
const MATERIAL_LOOK: Record<MaterialId, [number, number, number]> = { cement: [200, 200, 196], bricks: [196, 106, 74], glass: [150, 205, 235], steel: [150, 160, 172] };

/** A fenced site: materials piling up (share of each delivered), then walls rising with scaffolding and a crane. */
function site(f: Footprint, type: BuildingType, stage: 'materials' | 'building', progress: number, delivered: Partial<Record<MaterialId, number>>, levelUp: ReactNode[] | null) {
  const x0 = f.x + 0.1, y0 = f.y + 0.1, x1 = f.x + f.w - 0.1, y1 = f.y + f.h - 0.1;
  const out: ReactNode[] = [];
  if (!levelUp) out.push(flat(x0, y0, x1, y1, 0.04, '#b39b78'));
  if (stage === 'building' && !levelUp) {
    const h = Math.max(0.3, buildingHeight(type, 1) * Math.min(1, progress));
    out.push(box(x0 + 0.2, y0 + 0.2, x1 - 0.2, y1 - 0.2, 0.04, 0.16, faces([180, 184, 190])));
    out.push(box(x0 + 0.25, y0 + 0.25, x1 - 0.25, y0 + 0.45, 0.2, h, faces([196, 106, 74])));
    out.push(box(x0 + 0.25, y0 + 0.25, x0 + 0.45, y1 - 0.25, 0.2, h * 0.85, faces([196, 106, 74])));
    for (const x of [x0 + 0.3, (x0 + x1) / 2, x1 - 0.3]) for (const y of [(y0 + y1) / 2, y1 - 0.3]) out.push(<Line key={k()} a={[x, y, 0.2]} b={[x, y, h + 0.4]} stroke="#7f8a99" w={2.2} />);
  }
  if (levelUp) out.push(...levelUp);
  if (stage === 'building') {
    // Scaffolding on the front sides.
    const top = levelUp ? 2.6 : Math.max(0.8, buildingHeight(type, 1) * Math.min(1, progress) + 0.4);
    for (let x = x0; x <= x1 + 0.01; x += 0.6) out.push(<Line key={k()} a={[x, y1 + 0.12, 0.05]} b={[x, y1 + 0.12, top]} stroke="#f6a623" w={1.3} />);
    for (let z = 0.6; z <= top; z += 0.6) out.push(<Line key={k()} a={[x0, y1 + 0.12, z]} b={[x1, y1 + 0.12, z]} stroke="#f6a623" w={1.3} />);
    for (let y = y0; y <= y1 + 0.01; y += 0.6) out.push(<Line key={k()} a={[x1 + 0.12, y, 0.05]} b={[x1 + 0.12, y, top]} stroke="#e8951a" w={1.3} />);
  }
  // Material piles (they shrink as building goes on).
  const piles = (Object.entries(delivered) as [MaterialId, number][]).filter(([, t]) => t > 0);
  piles.forEach(([m, t], i) => {
    const size = Math.min(0.75, 0.25 + t / 40) * (stage === 'building' ? 1 - Math.min(0.8, progress) : 1);
    const px = x1 - 0.9 - i * 0.85, py = y1 + 0.25;
    if (m === 'steel') for (let j = 0; j < 3; j++) out.push(box(px - 0.4, py + j * 0.18, px + 0.5, py + j * 0.18 + 0.12, 0.05, 0.12, faces(MATERIAL_LOOK.steel)));
    else out.push(box(px, py, px + size, py + size, 0.05, size * 0.8, faces(MATERIAL_LOOK[m])));
  });
  // Construction fence.
  for (let x = x0; x <= x1 + 0.01; x += 0.5) out.push(<Line key={k()} a={[x, y1 + 0.95, 0]} b={[x, y1 + 0.95, 0.45]} stroke="#f97316" w={1.2} opacity={0.85} />);
  out.push(<Line key={k()} a={[x0, y1 + 0.95, 0.4]} b={[x1, y1 + 0.95, 0.4]} stroke="#f97316" w={1.4} opacity={0.85} />);
  return out;
}

function crane(x: number, y: number, jib: number) {
  const out: ReactNode[] = [box(x - 0.22, y - 0.22, x + 0.22, y + 0.22, 0, 0.3, faces([110, 110, 110]))];
  const H = 7.2;
  for (const [dx, dy] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]] as const) out.push(<Line key={k()} a={[x + dx, y + dy, 0.3]} b={[x + dx, y + dy, H]} stroke="#f6c343" w={1.6} />);
  for (let z = 0.3; z < H; z += 0.5) out.push(<Line key={k()} a={[x - 0.12, y + 0.12, z]} b={[x + 0.12, y + 0.12, z + 0.5]} stroke="#e0ac2c" w={0.9} />);
  out.push(box(x - 0.25, y - 0.25, x + 0.25, y + 0.25, H, 0.45, faces([246, 195, 67])));
  out.push(<Line key={k()} a={[x, y, H + 0.45]} b={[x, y + jib, H + 0.45]} stroke="#f6c343" w={2.4} />);
  out.push(<Line key={k()} a={[x, y, H + 0.25]} b={[x, y + jib, H + 0.25]} stroke="#d9a92f" w={1.3} />);
  for (let yy = y; yy < y + jib; yy += 0.5) out.push(<Line key={k()} a={[x, yy, H + 0.25]} b={[x, yy + 0.5, H + 0.45]} stroke="#d9a92f" w={0.8} />);
  out.push(<Line key={k()} a={[x, y, H + 0.45]} b={[x, y - 1.5, H + 0.45]} stroke="#f6c343" w={2.4} />);
  out.push(box(x - 0.2, y - 1.5, x + 0.2, y - 1.1, H - 0.1, 0.45, faces([140, 144, 150])));
  out.push(<Line key={k()} a={[x, y, H + 0.9]} b={[x, y + jib, H + 0.5]} stroke="#c4cad4" w={0.8} />);
  out.push(<Line key={k()} a={[x, y, H + 0.9]} b={[x, y - 1.5, H + 0.5]} stroke="#c4cad4" w={0.8} />);
  out.push(<Line key={k()} a={[x, y + jib * 0.65, H + 0.25]} b={[x, y + jib * 0.65, 3.2]} stroke="#cfd5de" w={0.8} />);
  out.push(box(x - 0.6, y + jib * 0.65 - 0.12, x + 0.6, y + jib * 0.65 + 0.12, 2.95, 0.2, faces([170, 178, 190])));
  return out;
}

// ── The scene ────────────────────────────────────────────────────────────
export interface SceneBuilding {
  type: BuildingType;
  x: number;
  y: number;
  level: number;
}
export interface SceneConstruction {
  type: BuildingType;
  status: 'materials' | 'building';
  /** 0..1 of the building time. */
  progress: number;
  delivered: Partial<Record<MaterialId, number>>;
}
export interface SceneProps {
  buildings: SceneBuilding[];
  construction: SceneConstruction | null;
  /** Building being placed or moved. */
  ghost: { type: BuildingType; x: number; y: number; valid: boolean } | null;
  selected: BuildingType | null;
  /** Trucks to show on the parking (the members' fleet). */
  parkedTrucks: number;
  /** Material loads driving to the plot right now. */
  incoming: number;
  /** Show the tile grid (placement). */
  grid: boolean;
}

const OUTSIDE_TREES: [number, number][] = [[-1.4, 3], [-2.2, 8], [-1.2, 11], [3, -1.6], [8, -2.2], [11, -1.4], [18.5, 2], [18.2, 8], [19, 11.5], [2, 16.5], [9, 16.8], [13, 16.2], [-3, 16], [-3.5, 0], [6, -3.5], [14.5, -3]];
const EDGE_SPOTS: [number, number][] = [[0.3, 0.3], [0.3, 4.6], [0.3, 6.4], [0.3, 11.4], [3.2, 0.3], [5.3, 0.3], [7.7, 0.3], [12.6, 0.3], [13.6, 2.4], [13.6, 6.6], [13.6, 11.4], [3.0, 11.6], [9.8, 11.6], [5.3, 11.4]];

export function PlotScene({ buildings, construction, ghost, selected, parkedTrucks, incoming, grid }: SceneProps) {
  // Keys are counted from zero on every render, so the same scene gets the same keys.
  // eslint-disable-next-line react-hooks/globals
  uid = 0;
  const items: { key: number; node: ReactNode }[] = [];
  const add = (key: number, node: ReactNode) => items.push({ key, node });
  const fp = (b: { type: BuildingType; x: number; y: number }): Footprint => ({ x: b.x, y: b.y, w: BUILDINGS[b.type].w, h: BUILDINGS[b.type].h });
  const occupied = (x: number, y: number) => buildings.some((b) => { const f = fp(b); return x >= f.x - 0.2 && x <= f.x + f.w + 0.2 && y >= f.y - 0.2 && y <= f.y + f.h + 1.2; });

  // Ground: fields, streets, sidewalks, the lawn, driveway and yard.
  const ground: ReactNode[] = [];
  ground.push(flat(-8, -8, 24, 22, 0, 'url(#plot-field)'));
  ground.push(flat(-8, 13, 24, 15.4, 0, '#646b77'), flat(15, -8, 17.4, 13, 0, '#646b77'));
  for (let x = -7; x < 24; x += 1.6) ground.push(flat(x, 14.15, x + 0.8, 14.25, 0.01, '#f4f1e2'));
  for (let y = -7; y < 13; y += 1.6) ground.push(flat(16.15, y, 16.25, y + 0.8, 0.01, '#f4f1e2'));
  ground.push(flat(-8, 12.4, 15, 13, 0.02, '#c9ccd2'), flat(14.4, -8, 15, 13, 0.02, '#c9ccd2'), flat(15, 12.4, 17.4, 13, 0.015, '#646b77'));
  ground.push(flat(-8, 0, -0.6, 12, 0.02, '#8fca7e'), flat(0, -8, 14, -0.6, 0.02, '#8fca7e'));
  ground.push(flat(0, 0, PLOT.w, PLOT.h, 0.03, 'url(#plot-lawn)'));
  const dx = PLOT.driveway.x;
  ground.push(flat(dx, PLOT.driveway.yFrom, dx + 1, 12.4, 0.04, '#717884'), flat(dx, PLOT.yardY, PLOT.w, PLOT.yardY + 1, 0.04, '#717884'));
  for (let y = PLOT.yardY + 1.3; y < 12.3; y += 1.2) ground.push(flat(dx + 0.46, y, dx + 0.54, y + 0.6, 0.05, '#f4f1e2'));
  if (grid) for (let x = 0; x <= PLOT.w; x++) ground.push(<Line key={k()} a={[x, 0, 0.05]} b={[x, PLOT.h, 0.05]} stroke="rgba(255,255,255,0.28)" w={0.8} />);
  if (grid) for (let y = 0; y <= PLOT.h; y++) ground.push(<Line key={k()} a={[0, y, 0.05]} b={[PLOT.w, y, 0.05]} stroke="rgba(255,255,255,0.28)" w={0.8} />);
  add(-100, <g key="ground">{ground}</g>);

  // Fence with the gate on the driveway.
  const fence: ReactNode[] = [];
  for (let x = 0; x <= PLOT.w; x += 1) if (x < dx - 0.2 || x > dx + 1.2) fence.push(<Line key={k()} a={[x, 12.2, 0]} b={[x, 12.2, 0.55]} stroke="#7c8696" w={1.4} />);
  for (let y = 0; y <= 12.2; y += 1) fence.push(<Line key={k()} a={[PLOT.w + 0.2, y, 0]} b={[PLOT.w + 0.2, y, 0.55]} stroke="#7c8696" w={1.4} />);
  fence.push(<Line key={k()} a={[0, 12.2, 0.5]} b={[dx - 0.3, 12.2, 0.5]} stroke="#7c8696" w={1.2} />, <Line key={k()} a={[dx + 1.3, 12.2, 0.5]} b={[PLOT.w + 0.2, 12.2, 0.5]} stroke="#7c8696" w={1.2} />, <Line key={k()} a={[PLOT.w + 0.2, 0, 0.5]} b={[PLOT.w + 0.2, 12.2, 0.5]} stroke="#7c8696" w={1.2} />);
  fence.push(box(dx - 0.3, 12.0, dx, 12.3, 0, 0.9, faces([226, 230, 236])), box(dx + 1, 12.0, dx + 1.3, 12.3, 0, 0.9, faces([226, 230, 236])));
  fence.push(<Line key={k()} a={[dx, 12.15, 0.6]} b={[dx + 0.9, 12.15, 0.6]} stroke="#e04545" w={3} strokeDasharray="6 5" />);
  add(25, <g key="fence">{fence}</g>);

  // Trees, bushes and lamps (none on top of a building).
  OUTSIDE_TREES.forEach(([x, y], i) => add(x + y + 0.6, tree(x, y, 0.5 + (i % 3) * 0.08, i)));
  EDGE_SPOTS.forEach(([x, y], i) => { if (!occupied(x, y)) add(x + y + 0.6, i % 3 === 2 ? bush(x, y) : tree(x, y, 0.45 + (i % 2) * 0.08, i)); });
  for (let x = 1; x < 15; x += 3.2) add(x + 12.8, lamp(x, 12.8));
  for (let y = 1; y < 13; y += 3.2) add(14.7 + y, lamp(14.7, y));

  // Traffic, and material loads arriving.
  add(9.5 + 34, car(9.5, 14.45, [224, 69, 69]));
  add(-2 + 34, car(-2, 14.45, [235, 240, 246]));
  add(16 + 6, car(15.45, 5.5, [246, 195, 67], false));
  for (let i = 0; i < Math.min(2, incoming); i++) {
    const x = 1.2 - i * 5.5, y = 13.35;
    const t: ReactNode[] = [
      box(x, y, x + 3.3, y + 0.85, 0.25, 0.22, faces([90, 96, 110])),
      box(x + 0.2, y + 0.1, x + 1.4, y + 0.75, 0.47, 0.5, faces([200, 200, 196])),
      box(x + 1.6, y + 0.1, x + 3.1, y + 0.75, 0.47, 0.5, faces([196, 106, 74])),
      box(x + 3.4, y + 0.02, x + 4.3, y + 0.83, 0.25, 1.05, faces([34, 211, 238])),
      onX(x + 4.3, y + 0.12, y + 0.73, 0.75, 1.15, '#d7f1ff'),
    ];
    add(y + x + 20, <g key={k()}>{t}</g>);
  }

  // Buildings and the construction site.
  for (const b of buildings) {
    const f = fp(b);
    const building = construction && construction.type === b.type ? construction : null;
    const node: ReactNode[] = [];
    const finished = (lvl: number) => (b.type === 'office' ? office(f, lvl) : b.type === 'logistics' ? logistics(f, lvl) : b.type === 'training' ? training(f, lvl) : b.type === 'service' ? service(f, lvl) : parking(f, lvl, parkedTrucks));
    if (building && b.level === 0) node.push(...site(f, b.type, building.status, building.progress, building.delivered, null));
    else if (building) node.push(...site(f, b.type, building.status, building.progress, building.delivered, finished(b.level)));
    else if (b.level > 0) node.push(...finished(b.level));
    if (selected === b.type) node.unshift(flat(f.x - 0.1, f.y - 0.1, f.x + f.w + 0.1, f.y + f.h + 0.1, 0.06, 'rgba(34,211,238,0.22)', { stroke: '#22d3ee', strokeWidth: 2 }));
    add(f.x + f.w + f.y + f.h - 0.5, <g key={`b-${b.type}`} data-building={b.type}>{node}</g>);
    if (building?.status === 'building' && b.type !== 'parking') add(f.x + f.y + 1, <g key={`crane-${b.type}`}>{crane(f.x - 0.4, f.y + 0.2, Math.max(3.5, f.h + 1.5))}</g>);
  }

  // The building being placed.
  if (ghost) {
    const def = BUILDINGS[ghost.type];
    const col = ghost.valid ? '34,211,238' : '224,69,69';
    const h = Math.max(0.4, buildingHeight(ghost.type, 1));
    add(200, (
      <g key="ghost" pointerEvents="none">
        {flat(ghost.x, ghost.y, ghost.x + def.w, ghost.y + def.h, 0.07, `rgba(${col},0.25)`, { stroke: `rgb(${col})`, strokeWidth: 2, strokeDasharray: '6 5' })}
        {box(ghost.x + 0.2, ghost.y + 0.2, ghost.x + def.w - 0.2, ghost.y + def.h - 0.2, 0.07, h, { top: `rgba(${col},0.18)`, left: `rgba(${col},0.12)`, right: `rgba(${col},0.08)` }, { stroke: `rgb(${col})`, strokeOpacity: 0.7, strokeWidth: 1 })}
      </g>
    ));
  }

  items.sort((a, b) => a.key - b.key);
  return (
    <>
      <defs>
        <pattern id="plot-lawn" width="24" height="24" patternUnits="userSpaceOnUse">
          <rect width="24" height="24" fill="#7cc36e" />
          <circle cx="4" cy="5" r="1.5" fill="#8ed27f" />
          <circle cx="16" cy="13" r="1.3" fill="#6db462" />
          <circle cx="10" cy="20" r="1.2" fill="#93d784" />
        </pattern>
        <pattern id="plot-field" width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#9fd48c" />
          <circle cx="7" cy="9" r="1.4" fill="#b2de9f" />
          <circle cx="22" cy="23" r="1.4" fill="#8cc67a" />
        </pattern>
        <linearGradient id="plot-sun" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff6d6" stopOpacity="0.28" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={VIEW.w * 3} height={VIEW.h * 3} x={-VIEW.w} y={-VIEW.h} fill="#9fd48c" />
      {items.map((i) => i.node)}
      <rect width={VIEW.w * 3} height={VIEW.h * 3} x={-VIEW.w} y={-VIEW.h} fill="url(#plot-sun)" pointerEvents="none" />
    </>
  );
}
