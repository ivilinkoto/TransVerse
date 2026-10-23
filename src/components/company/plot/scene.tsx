/**
 * The company plot drawn in isometric view, in daylight: lawn, driveway,
 * fence and gate, the street outside, trees, lamps, the buildings (each type
 * and level its own illustration), construction sites with a crane, and the
 * ghost of a building being placed. 1 tile = one grid square of the plot.
 * Pure drawing — no state.
 */
import type { ReactNode } from 'react';
import { BUILDINGS, DECOR, PLOT, type BuildingType, type DecorKind, type MaterialId, type PlacedDecor } from '@/lib/game/plot';

export const TILE = 40;
const C = Math.cos(Math.PI / 6);
/** Scene origin (screen position of tile 0,0 at ground level) and size of the drawing. */
export const ORIGIN = { x: 560, y: 250 };
/** The part of the drawing shown at zoom 1: the plot with the street in front. */
export const VIEW = { x: 60, y: 40, w: 1080, h: 780 };
/** The view of a plot that was made wider: the same proportions, a little further out. */
export function viewFor(plotW: number) {
  const f = 1 + ((plotW - PLOT.w) * C * TILE) / VIEW.w;
  return { x: VIEW.x, y: VIEW.y, w: VIEW.w * f, h: VIEW.h * f };
}

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
/** The season of the current render: snow on roofs, lawns and trees; Christmas lights. */
let SNOW = false;
let XMAS = false;
/** Баба Марта (March, v1.5): a blossoming tree with martenitsas by the gate. */
let MARTA = false;
/** Evening and night: lit windows, lamps and headlights; autumn leaves. */
let NIGHT = false;
let AUTUMN = false;
/** Warm light colours: the night filter keeps exactly these bright (warm, little blue). */
const LIT = ['#ffd84a', '#ffe066', '#ffcf40'];
/** Traffic is drawn outside the night filter (it moves): it darkens its own colours. */
let DIM = false;
/** Headlights: warm at night (so the night filter keeps them bright). */
const head = () => (NIGHT ? '#ffe066' : '#fff3b8');
const tone = (rgb: [number, number, number]): [number, number, number] => (DIM ? [rgb[0] * 0.27, rgb[1] * 0.31, rgb[2] * 0.48 + 15] : rgb);
/** A window: at night most of them are lit (the same ones every time). */
const win = (day: string, i: number) => (NIGHT && ((i * 7 + 3) % 10) < 6 ? LIT[i % 3]! : day);

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
      <Poly p={[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]} fill={SNOW && h > 0.15 && !extra.stroke ? '#f3f7fb' : c.top} {...extra} />
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
type RGB = [number, number, number];
const GLASS_DAY: Faces = { top: '#cfeaff', left: '#9fd2f5', right: '#7fb6dc' };
const GLASS_DIM: Faces = { top: '#3b5266', left: '#30475c', right: '#273b4e' };
const glass = () => (DIM ? GLASS_DIM : GLASS_DAY);
const DARK: Faces = faces([44, 48, 56]);

/** A wheel standing in a vertical plane (x = plane, or y = plane), centred at `c` along it: tyre, rim and hub. */
function wheel(plane: 'x' | 'y', at: number, c: number, r = 0.19): ReactNode {
  const ring = (rr: number): Pt[] => Array.from({ length: 18 }, (_, i) => {
    const t = (i / 18) * Math.PI * 2;
    return plane === 'x' ? [at, c + rr * Math.cos(t), r + rr * Math.sin(t)] : [c + rr * Math.cos(t), at, r + rr * Math.sin(t)];
  });
  return (
    <g key={k()}>
      <Poly p={ring(r)} fill="#17191d" stroke="#0b0c0f" strokeWidth={0.6} />
      <Poly p={ring(r * 0.62)} fill="#aeb6c3" />
      <Poly p={ring(r * 0.28)} fill="#59606d" />
    </g>
  );
}

/**
 * Drawing in a vehicle's own frame: `a` along the driving direction (the front
 * at a = length), `b` across (the visible side at b = width). The vehicle drives
 * along x or along y of the plot.
 */
function frame(x: number, y: number, along: 'x' | 'y', rev = false, len = 0) {
  // A vehicle driving the other way: its own frame mirrored along its length.
  const m = (a: number) => (rev ? len - a : a);
  const at = (a: number, b: number): [number, number] => (along === 'y' ? [x + b, y + m(a)] : [x + m(a), y + b]);
  return {
    box(a0: number, b0: number, a1: number, b1: number, z0: number, h: number, c: Faces) {
      const [xa, ya] = at(a0, b0);
      const [xb, yb] = at(a1, b1);
      return box(Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb), z0, h, c);
    },
    /** A panel on the visible side (b = const). */
    side(b: number, a0: number, a1: number, z0: number, z1: number, fill: string) {
      const [p, q] = [m(a0), m(a1)].sort((u, v) => u - v);
      return along === 'y' ? onX(x + b, y + p!, y + q!, z0, z1, fill) : onY(y + b, x + p!, x + q!, z0, z1, fill);
    },
    /** A panel on the front (a = const). */
    front: (a: number, b0: number, b1: number, z0: number, z1: number, fill: string) => (along === 'y' ? onY(y + m(a), x + b0, x + b1, z0, z1, fill) : onX(x + m(a), y + b0, y + b1, z0, z1, fill)),
    wheel: (b: number, a: number, r?: number) => (along === 'y' ? wheel('x', x + b, y + m(a), r) : wheel('y', y + b, x + m(a), r)),
    /** A patch of ground in the vehicle's frame (headlight beams). */
    ground(a0: number, b0: number, a1: number, b1: number, fill: string) {
      const [xa, ya] = at(a0, b0);
      const [xb, yb] = at(a1, b1);
      return flat(Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb), 0.03, fill);
    },
    shadow(len: number, w: number, h: number) {
      const [xa, ya] = at(0, 0);
      const [xb, yb] = at(len, w);
      return shadow(Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb), h);
    },
  };
}

interface TruckLook {
  cab: RGB;
  body: RGB;
  /** A box truck that fits a parking bay instead of a tractor with a semi-trailer. */
  rigid?: boolean;
  along?: 'x' | 'y';
  /** A flatbed with a load (material colours) instead of a box. */
  load?: RGB[];
  /** Width across (tiles); parked trucks are a little narrower so their neighbours do not hide the front wheels. */
  width?: number;
}

/** A truck: chassis, wheels, a cab with windscreen, lights, grille and mirror, and a box (or a flatbed with a load). */
function truck(x: number, y: number, look: TruckLook) {
  const f = frame(x, y, look.along ?? 'y');
  const W = look.width ?? 0.9;
  const body = look.rigid ? 1.7 : 3.2;
  const cab0 = body + 0.12, cab1 = cab0 + 0.95;
  const out: ReactNode[] = [f.shadow(cab1, W, 1.3)];
  // Only trucks on the road have their lights on (parked ones stand dark).
  if (DIM) out.push(f.ground(cab1, -0.1, cab1 + 2.2, W + 0.1, 'rgba(255,230,150,0.2)'));
  // The axles: the front one sits under the cab, close to the bumper.
  const axles = look.rigid ? [0.4, cab1 - 0.3] : [0.45, 0.88, 1.31, body - 0.15, cab1 - 0.32];
  // Wheels on the far side first: the body hides most of them, the bottom shows under the chassis.
  for (const a of axles) out.push(f.wheel(0.04, a));
  // Chassis rails, then the body.
  out.push(f.box(0.1, 0.15, cab1 - 0.1, W - 0.15, 0.16, 0.12, DARK));
  const cabRgb = tone(look.cab), bodyRgb = tone(look.body);
  if (look.load) {
    out.push(f.box(0, 0, body, W, 0.28, 0.1, faces([96, 104, 118])));
    const n = look.load.length;
    look.load.forEach((raw, i) => {
      const rgb = tone(raw);
      const a0 = 0.15 + (i * (body - 0.3)) / n;
      out.push(f.box(a0, 0.1, a0 + (body - 0.3) / n - 0.1, W - 0.1, 0.38, 0.45, faces(rgb)));
    });
    out.push(f.box(body - 0.08, 0.05, body, W - 0.05, 0.38, 0.75, DARK));
  } else {
    out.push(f.box(0, 0, body, W, 0.3, look.rigid ? 1.05 : 1.15, faces(bodyRgb)));
    // Ribs, a colour stripe and the side guard.
    for (let a = 0.35; a < body - 0.1; a += 0.45) out.push(f.side(W, a, a + 0.03, 0.34, look.rigid ? 1.3 : 1.4, shade(bodyRgb, 0.82)));
    out.push(f.side(W, 0.12, body - 0.12, 0.62, 0.74, shade(cabRgb, 0.95)));
    out.push(f.side(W, 0.6, body - 0.6, 0.2, 0.26, '#3a3f48'));
  }
  // The cab: a roof spoiler on a tractor, windscreen, side window and door, lights, grille, bumper and a mirror.
  out.push(f.box(cab0, 0.04, cab1, W - 0.04, 0.24, 1.0, faces(cabRgb)));
  if (!look.rigid) out.push(f.box(cab0 + 0.05, 0.12, cab0 + 0.55, W - 0.12, 1.24, 0.22, faces(cabRgb)));
  out.push(f.front(cab1, 0.1, W - 0.1, 0.74, 1.14, glass().left));
  out.push(f.front(cab1, 0.12, W - 0.12, 1.06, 1.12, 'rgba(255,255,255,0.45)'));
  out.push(f.side(W - 0.04, cab1 - 0.5, cab1 - 0.08, 0.74, 1.12, glass().right));
  out.push(f.side(W - 0.04, cab1 - 0.55, cab1 - 0.53, 0.3, 1.14, shade(cabRgb, 0.7)));
  out.push(f.side(W - 0.04, cab1 - 0.3, cab1 - 0.2, 0.62, 0.66, '#3a3f48'));
  out.push(f.front(cab1, 0.28, W - 0.28, 0.38, 0.64, '#2b2f37'));
  for (let z = 0.43; z < 0.62; z += 0.06) out.push(f.front(cab1, 0.3, W - 0.3, z, z + 0.015, '#6b7280'));
  out.push(f.front(cab1, 0.08, 0.22, 0.4, 0.5, head()), f.front(cab1, W - 0.22, W - 0.08, 0.4, 0.5, head()));
  out.push(f.front(cab1, 0.05, W - 0.05, 0.22, 0.34, '#3a3f48'));
  out.push(f.box(cab1 - 0.12, W - 0.02, cab1 - 0.06, W + 0.05, 0.78, 0.26, DARK));
  // Wheels on the visible side.
  for (const a of axles) out.push(f.wheel(W - 0.02, a));
  return <g key={k()}>{out}</g>;
}

/** A car: body, cabin with windows, lights and wheels. `rev`: driving towards −x / −y (its rear faces the viewer). */
function car(x: number, y: number, rgb: RGB, alongX = true, rev = false) {
  // (rgb is darkened at night for the traffic.)
  const L = 1.3, W = 0.6;
  const f = frame(x, y, alongX ? 'x' : 'y', rev, L);
  rgb = tone(rgb);
  return (
    <g key={k()}>
      {f.shadow(L, W, 0.6)}
      {DIM && f.ground(L, -0.05, L + 1.8, W + 0.05, 'rgba(255,230,150,0.2)')}
      {f.box(0, 0, L, W, 0.12, 0.3, faces(rgb))}
      {f.box(0.32, 0.05, 1.0, W - 0.05, 0.42, 0.26, faces(rgb))}
      {f.side(W - 0.05, 0.36, 0.64, 0.46, 0.64, glass().right)}
      {f.side(W - 0.05, 0.68, 0.96, 0.46, 0.64, glass().right)}
      {rev ? f.front(0.32, 0.1, W - 0.1, 0.46, 0.64, glass().left) : f.front(1.0, 0.08, W - 0.08, 0.45, 0.66, glass().left)}
      {rev ? f.front(0, 0.04, 0.14, 0.27, 0.34, '#e04545') : f.front(L, 0.04, 0.14, 0.26, 0.34, head())}
      {rev ? f.front(0, W - 0.14, W - 0.04, 0.27, 0.34, '#e04545') : f.front(L, W - 0.14, W - 0.04, 0.26, 0.34, head())}
      {f.front(rev ? 0 : L, 0.02, W - 0.02, 0.12, 0.2, '#3a3f48')}
      {f.wheel(W - 0.01, 0.28, 0.13)}
      {f.wheel(W - 0.01, L - 0.28, 0.13)}
    </g>
  );
}

/**
 * A vehicle driving along a road and starting over: drawn at the start of
 * the road and moved `dist` tiles along x or y, `phase` (0–1) of the way in.
 * Without `moving` it just stands at that point of the road.
 */
function driving(node: (x: number, y: number) => ReactNode, from: [number, number], along: 'x' | 'y', dist: number, seconds: number, phase: number, moving: boolean) {
  const d = along === 'x' ? [dist, 0] : [0, dist];
  if (!moving) return node(from[0] + d[0]! * phase, from[1] + d[1]! * phase);
  const [x0, y0] = P(from[0], from[1]);
  const [x1, y1] = P(from[0] + d[0]!, from[1] + d[1]!);
  return (
    <g key={k()}>
      {node(from[0], from[1])}
      <animateTransform attributeName="transform" type="translate" from="0 0" to={`${(x1 - x0).toFixed(1)} ${(y1 - y0).toFixed(1)}`} dur={`${seconds}s`} begin={`${(-phase * seconds).toFixed(1)}s`} repeatCount="indefinite" />
    </g>
  );
}

// ── Nature ───────────────────────────────────────────────────────────────
function tree(x: number, y: number, r = 0.55, v = 0) {
  const [tx, ty] = P(x, y, 0);
  const [cx, cy] = P(x, y, 1.2);
  const greens = AUTUMN ? ['#d9822b', '#c4562a', '#e0a63a'] : ['#3f9a4f', '#358a45', '#4caa5a'];
  return (
    <g key={k()}>
      <ellipse cx={tx + 10} cy={ty + 2} rx={r * TILE} ry={r * TILE * 0.45} fill="rgba(20,40,25,0.25)" />
      <rect x={tx - 2.5} y={cy} width={5} height={ty - cy} fill="#7a5235" />
      <circle cx={cx} cy={cy} r={r * TILE} fill={SNOW ? '#2f6f45' : greens[v % 3]} />
      <circle cx={cx - r * TILE * 0.32} cy={cy - r * TILE * 0.35} r={r * TILE * 0.55} fill={SNOW ? '#f4f8fb' : AUTUMN ? '#f2c25a' : '#6cc977'} opacity={SNOW ? 0.9 : 0.6} />
    </g>
  );
}
function bush(x: number, y: number) {
  const [cx, cy] = P(x, y, 0.25);
  return (
    <g key={k()}>
      <ellipse cx={cx} cy={cy} rx={11} ry={7} fill={SNOW ? '#2f6f45' : '#3f9a4f'} />
      <ellipse cx={cx - 3} cy={cy - 3} rx={6} ry={4} fill={SNOW ? '#f4f8fb' : '#73cf7e'} opacity={0.8} />
    </g>
  );
}
function lamp(x: number, y: number) {
  const [bx, by] = P(x, y, 0);
  const [tx, ty] = P(x, y, 1.6);
  return (
    <g key={k()}>
      {NIGHT && <ellipse cx={bx} cy={by} rx={34} ry={17} fill="rgba(255,214,60,0.3)" />}
      <line x1={bx} y1={by} x2={tx} y2={ty} stroke="#5e6676" strokeWidth={1.8} />
      <rect x={tx - 5} y={ty - 2} width={10} height={4} rx={2} fill={NIGHT ? '#ffd84a' : '#4a5160'} />
      {NIGHT && <circle cx={tx} cy={ty + 2} r={12} fill="url(#plot-glow)" />}
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
    case 'warehouse':
      return 1.8 + level * 0.15;
    case 'rest':
      return 1.5 + (level >= 2 ? 0.9 : 0);
    case 'factory':
      return 1.9 + level * 0.15;
    case 'fuel':
      return 1.2;
    case 'polygon':
      return 1.4 + level * 0.2;
    case 'museum':
      return 1.9 + level * 0.25;
  }
}

function office(f: Footprint, level: number) {
  const x0 = f.x + 0.2, y0 = f.y + 0.2, x1 = f.x + f.w - 0.3, y1 = f.y + f.h - 0.2;
  const floors = 1 + Math.max(1, level);
  const h = buildingHeight('office', level);
  const out: ReactNode[] = [shadow(x0, y0, x1, y1, h), box(x0, y0, x1, y1, 0, h, { top: '#e9eef4', left: '#c7d1de', right: '#a5b2c4' })];
  for (let fl = 0; fl < floors; fl++) {
    const za = 0.35 + fl * 0.95, zb = za + 0.62;
    for (let x = x0 + 0.15; x < x1 - 0.2; x += 0.5) out.push(onY(y1, x, x + 0.38, za, zb, win((Math.round(x * 3) + fl) % 4 === 0 ? '#bfe3fb' : '#5fa8d9', Math.round(x * 3) + fl * 5)));
    for (let y = y0 + 0.15; y < y1 - 0.2; y += 0.5) out.push(onX(x1, y, y + 0.38, za, zb, win((Math.round(y * 3) + fl) % 4 === 1 ? '#9fd0f0' : '#3f86bb', Math.round(y * 3) + fl * 3 + 1)));
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
    for (let x = x0 + 0.2; x < x1 - 0.2; x += 0.65) out.push(onY(y1, x, x + 0.5, za, zb, '#f3f6fa'), onY(y1, x + 0.05, x + 0.45, za + 0.05, zb - 0.05, win('#6fb1dc', Math.round(x * 4) + r * 3)));
    for (let y = y0 + 0.2; y < y1 - 0.2; y += 0.65) out.push(onX(x1, y, y + 0.5, za, zb, win('#4b8fbf', Math.round(y * 4) + r * 5)));
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

function warehouse(f: Footprint, level: number) {
  const x0 = f.x + 0.15, y0 = f.y + 0.15, x1 = f.x + f.w - 0.2, y1 = f.y + f.h - 0.55;
  const h = buildingHeight('warehouse', level);
  const out: ReactNode[] = [shadow(x0, y0, x1, y1, h), box(x0, y0, x1, y1, 0, h, faces([150, 172, 196]))];
  // Corrugated walls, an orange band and vents on the roof.
  for (let x = x0 + 0.15; x < x1; x += 0.2) out.push(<Line key={k()} a={[x, y1, 0.05]} b={[x, y1, h - 0.3]} stroke="#93a8bf" w={0.7} />);
  out.push(box(x0, y1 - 0.08, x1, y1, h - 0.3, 0.22, faces([249, 115, 22])));
  for (let x = x0 + 0.6; x < x1 - 0.4; x += 1.1) out.push(box(x, (y0 + y1) / 2 - 0.2, x + 0.35, (y0 + y1) / 2 + 0.2, h, 0.25, faces([170, 178, 190])));
  // Roll-up doors and pallets of goods outside, more with every level.
  const doors = 1 + level;
  const step = (x1 - x0 - 0.2) / doors;
  for (let i = 0; i < doors; i++) {
    const xa = x0 + 0.15 + i * step;
    out.push(onY(y1, xa, xa + step * 0.75, 0.05, 1.05, '#5d6878'));
    for (let z = 0.15; z < 1.05; z += 0.12) out.push(<Line key={k()} a={[xa, y1, z]} b={[xa + step * 0.75, y1, z]} stroke="#76839a" w={0.6} />);
  }
  for (let i = 0; i < level + 1; i++) {
    const px = x0 + 0.2 + i * 0.75;
    out.push(box(px, y1 + 0.15, px + 0.55, y1 + 0.6, 0.05, 0.1, faces([196, 160, 112])));
    out.push(box(px + 0.04, y1 + 0.18, px + 0.51, y1 + 0.57, 0.15, 0.32 + (i % 2) * 0.1, faces([224, 196, 150])));
  }
  return out;
}

function rest(f: Footprint, level: number) {
  const x0 = f.x + 0.25, y0 = f.y + 0.25, x1 = f.x + f.w - 0.3, y1 = f.y + f.h - 0.6;
  const h = buildingHeight('rest', level);
  const out: ReactNode[] = [shadow(x0, y0, x1, y1, h), box(x0, y0, x1, y1, 0, h, faces([236, 214, 178]))];
  // Wide warm windows, a café terrace with umbrellas and a sign.
  const rows = h > 2 ? 2 : 1;
  for (let r = 0; r < rows; r++) for (let x = x0 + 0.15; x < x1 - 0.3; x += 0.7) out.push(onY(y1, x, x + 0.55, 0.3 + r * 0.9, 0.95 + r * 0.9, win(r === 0 ? '#ffd998' : '#8cc4e8', Math.round(x * 4) + r)));
  for (let y = y0 + 0.2; y < y1 - 0.3; y += 0.7) out.push(onX(x1, y, y + 0.5, 0.3, 0.95, win('#f2c27a', Math.round(y * 4) + 2)));
  out.push(box(x0, y1 - 0.1, x1, y1, h - 0.25, 0.22, faces([47, 123, 255])));
  out.push(<Poly key={k()} p={[[x0 - 0.05, y0, h], [x1 + 0.05, y0, h], [x1 + 0.05, y1 + 0.25, h - 0.35], [x0 - 0.05, y1 + 0.25, h - 0.35]]} fill={SNOW ? '#f3f7fb' : '#8b5e3c'} />);
  for (let i = 0; i < Math.min(3, level + 1); i++) {
    const ux = x0 + 0.4 + i * 0.75, uy = y1 + 0.55;
    out.push(<Line key={k()} a={[ux, uy, 0]} b={[ux, uy, 0.75]} stroke="#7a5235" w={1.2} />);
    out.push(<Poly key={k()} p={[[ux - 0.32, uy, 0.7], [ux, uy - 0.32, 0.7], [ux + 0.32, uy, 0.7], [ux, uy + 0.32, 0.7], [ux, uy, 0.95]]} fill={i % 2 ? '#e04545' : '#f6c343'} />);
  }
  return out;
}

function factory(f: Footprint, level: number) {
  const x0 = f.x + 0.15, y0 = f.y + 0.15, x1 = f.x + f.w - 0.2, y1 = f.y + f.h - 0.5;
  const h = buildingHeight('factory', level);
  const out: ReactNode[] = [shadow(x0, y0, x1, y1, h + 0.5), box(x0, y0, x1, y1, 0, h, faces([178, 94, 72]))];
  // Brick hall with a sawtooth roof (glass on the steep side), a loading door and a chimney, taller with the level.
  const teeth = Math.max(3, Math.round((x1 - x0) / 0.9));
  const step = (x1 - x0) / teeth;
  for (let i = 0; i < teeth; i++) {
    const xa = x0 + i * step, xb = xa + step;
    out.push(<Poly key={k()} p={[[xa, y0, h], [xb, y0, h], [xb, y0, h + 0.45], [xb, y1, h + 0.45], [xb, y1, h], [xa, y1, h]]} fill={SNOW ? '#f3f7fb' : '#7c838f'} />);
    out.push(<Poly key={k()} p={[[xb, y0, h], [xb, y1, h], [xb, y1, h + 0.45], [xb, y0, h + 0.45]]} fill="#9fd0f0" />);
  }
  for (let x = x0 + 0.25; x < x1 - 0.3; x += 0.55) out.push(onY(y1, x, x + 0.35, 0.9, 1.45, win('#ffd998', Math.round(x * 5))));
  out.push(onY(y1, x1 - 1.2, x1 - 0.25, 0.05, 1.1, '#4b5563'));
  for (let z = 0.15; z < 1.1; z += 0.13) out.push(<Line key={k()} a={[x1 - 1.2, y1, z]} b={[x1 - 0.25, y1, z]} stroke="#6b7280" w={0.6} />);
  const cx = x0 + 0.35, cy = y0 + 0.35;
  out.push(box(cx, cy, cx + 0.35, cy + 0.35, 0, h + 1.1 + level * 0.3, faces([150, 74, 56])));
  out.push(box(cx - 0.03, cy - 0.03, cx + 0.38, cy + 0.38, h + 1.0 + level * 0.3, 0.12, faces([90, 90, 96])));
  return out;
}

/** A fuel station: a canopy on columns over the pumps, a small shop and a price sign (taller with the level). */
function fuelStation(f: Footprint, level: number) {
  const x0 = f.x + 0.15, y0 = f.y + 0.15, x1 = f.x + f.w - 0.2, y1 = f.y + f.h - 0.2;
  const out: ReactNode[] = [flat(x0, y0, x1, y1, 0.04, '#6b717c')];
  // The shop at the back.
  const sx1 = x0 + 0.9;
  out.push(shadow(x0, y0, sx1, y1, 0.9), box(x0, y0, sx1, y1, 0, 0.9, faces([236, 240, 245])));
  out.push(onX(sx1, y0 + 0.2, y1 - 0.2, 0.15, 0.7, win('#9fd0f0', 3)));
  // Pumps, one more per level.
  const pumps = 1 + level;
  for (let i = 0; i < pumps; i++) {
    const px = sx1 + 0.45 + i * ((x1 - sx1 - 0.6) / Math.max(1, pumps));
    out.push(box(px, (y0 + y1) / 2 - 0.12, px + 0.22, (y0 + y1) / 2 + 0.12, 0, 0.5, faces([224, 69, 69])));
  }
  // The canopy on four columns.
  const h = buildingHeight('fuel', level);
  for (const [cx, cy] of [[sx1 + 0.25, y0 + 0.15], [x1 - 0.15, y0 + 0.15], [sx1 + 0.25, y1 - 0.25], [x1 - 0.15, y1 - 0.25]] as [number, number][]) out.push(box(cx, cy, cx + 0.08, cy + 0.08, 0, h, faces([200, 205, 212])));
  out.push(box(sx1 + 0.15, y0, x1, y1, h, 0.2, { top: SNOW ? '#f3f7fb' : '#f8fafc', left: '#e04545', right: '#c53030' }));
  // The price sign.
  out.push(box(x1 - 0.12, y1 - 0.05, x1, y1 + 0.07, 0, 1.6 + level * 0.15, faces([38, 52, 74])));
  return out;
}

/** A driving range: an asphalt pad with a painted slalom of cones, a reversing bay and a small control tower (taller with the level). */
function polygon(f: Footprint, level: number) {
  const x0 = f.x + 0.1, y0 = f.y + 0.1, x1 = f.x + f.w - 0.1, y1 = f.y + f.h - 0.1;
  const out: ReactNode[] = [flat(x0, y0, x1, y1, 0.04, '#5d636e')];
  // The painted lane around the pad and the reversing bay.
  out.push(flat(x0 + 0.15, y0 + 0.15, x1 - 0.15, y0 + 0.22, 0.05, '#f2f0e4'), flat(x0 + 0.15, y1 - 0.22, x1 - 0.15, y1 - 0.15, 0.05, '#f2f0e4'));
  out.push(flat(x1 - 1.1, y0 + 0.5, x1 - 1.04, y1 - 0.5, 0.05, '#f6c343'), flat(x1 - 0.4, y0 + 0.5, x1 - 0.34, y1 - 0.5, 0.05, '#f6c343'));
  // The slalom: more cones with each level.
  const cones = 3 + level;
  for (let i = 0; i < cones; i++) {
    const cx = x0 + 0.5 + i * ((x1 - x0 - 2) / cones);
    const cy = (y0 + y1) / 2 + (i % 2 ? 0.35 : -0.35);
    out.push(box(cx, cy, cx + 0.12, cy + 0.12, 0, 0.25, faces([249, 115, 22])));
  }
  // The control tower.
  const h = buildingHeight('polygon', level);
  const tx = x0 + 0.1, ty = y1 - 0.75;
  out.push(shadow(tx, ty, tx + 0.6, ty + 0.6, h), box(tx, ty, tx + 0.6, ty + 0.6, 0, h, faces([226, 232, 240])));
  out.push(onY(ty + 0.6, tx + 0.05, tx + 0.55, h - 0.45, h - 0.1, win('#9fd0f0', 7)));
  out.push(box(tx - 0.05, ty - 0.05, tx + 0.65, ty + 0.65, h, 0.08, faces([224, 69, 69])));
  return out;
}

/** A museum: a stone hall with columns under a pediment and a tall glass front over a stone plaza; more columns with each level. */
function museum(f: Footprint, level: number) {
  const x0 = f.x + 0.2, y0 = f.y + 0.15, x1 = f.x + f.w - 0.2, y1 = f.y + f.h - 0.75;
  const h = buildingHeight('museum', level);
  const stone = { top: '#efe7d6', left: '#d9cdb3', right: '#c2b493' };
  const out: ReactNode[] = [flat(f.x + 0.05, y1, f.x + f.w - 0.05, f.y + f.h - 0.05, 0.04, '#d9cdb3'), shadow(x0, y0, x1, y1, h)];
  out.push(box(x0, y0, x1, y1, 0, h, stone));
  out.push(onY(y1, x0 + 0.35, x1 - 0.35, 0.2, h - 0.45, win('#9fd0f0', 11)));
  // Columns along the front, more with the level.
  const columns = 3 + level;
  for (let i = 0; i < columns; i++) {
    const cx = x0 + 0.05 + (i * (x1 - x0 - 0.22)) / (columns - 1);
    out.push(box(cx, y1 + 0.02, cx + 0.12, y1 + 0.14, 0, h, { top: '#f7f2e6', left: '#e6dcc6', right: '#d1c4a6' }));
  }
  // The pediment and the roof.
  out.push(box(x0 - 0.08, y0 - 0.08, x1 + 0.08, y1 + 0.18, h, 0.18, { top: '#c9b98f', left: '#b8a77c', right: '#a3916a' }));
  out.push(box(x0 + 0.3, y0 + 0.3, x1 - 0.3, y1 - 0.1, h + 0.18, 0.22, { top: '#b8a77c', left: '#a3916a', right: '#8f7e5a' }));
  // Steps up to the entrance.
  out.push(box(x0 + 0.6, y1 + 0.15, x1 - 0.6, y1 + 0.45, 0, 0.08, stone), box(x0 + 0.7, y1 + 0.15, x1 - 0.7, y1 + 0.3, 0.08, 0.08, stone));
  return out;
}

function parking(f: Footprint, level: number, trucks: number, livery: string | null) {
  const x0 = f.x + 0.1, y0 = f.y + 0.1, x1 = f.x + f.w - 0.1, y1 = f.y + f.h - 0.1;
  const out: ReactNode[] = [flat(x0, y0, x1, y1, 0.04, '#6b717c'), flat(x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 0.05, 0.045, '#5d636e')];
  const bays = Math.max(3, Math.min(Math.floor((x1 - x0) / 1.2), 2 + level));
  const step = (x1 - x0) / bays;
  for (let i = 0; i <= bays; i++) out.push(flat(x0 + i * step, y0 + 0.2, x0 + i * step + 0.06, y1 - 0.2, 0.05, '#f2f0e4'));
  const colors: [number, number, number][] = [[47, 123, 255], [246, 195, 67], [166, 107, 255], [47, 210, 122], [224, 69, 69]];
  const rgb = livery ? ([1, 3, 5].map((i) => parseInt(livery.slice(i, i + 2), 16)) as [number, number, number]) : null;
  for (let i = 0; i < Math.min(trucks, bays); i++) out.push(truck(x0 + i * step + (step - 0.78) / 2, y0 + 0.15, { cab: rgb ?? [235, 240, 246], body: rgb ? [235, 240, 246] : colors[i % colors.length]!, rigid: true, width: 0.78 }));
  // A light pole at the corner.
  out.push(lamp(x0 + 0.1, y1 - 0.1));
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

// ── Decorations and the season ───────────────────────────────────────────
function decoration(d: PlacedDecor, livery: string | null): ReactNode[] {
  const { x, y } = d;
  const cx = x + 0.5, cy = y + 0.5;
  switch (d.kind) {
    case 'flowerbed': {
      const out: ReactNode[] = [box(x + 0.1, y + 0.1, x + 0.9, y + 0.9, 0.03, 0.12, faces([150, 110, 80]))];
      if (!SNOW) [[0.3, 0.3, '#e04545'], [0.6, 0.35, '#f6c343'], [0.4, 0.65, '#a66bff'], [0.7, 0.7, '#ff7ab6']].forEach(([dx, dy, c]) => { const [px, py] = P(x + (dx as number), y + (dy as number), 0.2); out.push(<circle key={k()} cx={px} cy={py} r={3.2} fill={c as string} />); });
      return out;
    }
    case 'bench':
      return [box(x + 0.15, y + 0.35, x + 0.85, y + 0.6, 0.25, 0.08, faces([150, 100, 60])), box(x + 0.15, y + 0.3, x + 0.85, y + 0.38, 0.33, 0.22, faces([150, 100, 60])), box(x + 0.2, y + 0.4, x + 0.28, y + 0.55, 0, 0.25, faces([70, 70, 75])), box(x + 0.72, y + 0.4, x + 0.8, y + 0.55, 0, 0.25, faces([70, 70, 75]))];
    case 'tree':
      return [tree(cx, cy, 0.42, Math.round(x + y))];
    case 'flag': {
      const color = livery ?? '#22d3ee';
      return [<Line key={k()} a={[cx, cy, 0]} b={[cx, cy, 2.4]} stroke="#9aa3b2" w={1.6} />, <Poly key={k()} p={[[cx, cy, 2.35], [cx, cy + 0.75, 2.3], [cx, cy + 0.75, 1.85], [cx, cy, 1.9]]} fill={color} />];
    }
    case 'sign':
      return [box(x + 0.2, y + 0.4, x + 0.3, y + 0.5, 0, 0.6, faces([90, 96, 110])), box(x + 1.7, y + 0.4, x + 1.8, y + 0.5, 0, 0.6, faces([90, 96, 110])), box(x + 0.1, y + 0.4, x + 1.9, y + 0.55, 0.6, 0.55, { top: '#e8eef7', left: livery ?? '#2f7bff', right: '#1f52ad' }), onY(y + 0.55, x + 0.3, x + 1.7, 0.78, 0.92, '#ffffff')];
    case 'fountain': {
      const out: ReactNode[] = [];
      const [fx, fy] = P(x + 1, y + 1, 0.15);
      out.push(<ellipse key={k()} cx={fx} cy={fy + 2} rx={0.95 * TILE} ry={0.5 * TILE} fill="#b9c2cf" />, <ellipse key={k()} cx={fx} cy={fy} rx={0.85 * TILE} ry={0.43 * TILE} fill={SNOW ? '#dceaf5' : '#5fb4e6'} />);
      out.push(box(x + 0.85, y + 0.85, x + 1.15, y + 1.15, 0.1, 0.6, faces([200, 206, 214])));
      if (!SNOW) { const [tx, ty] = P(x + 1, y + 1, 0.95); out.push(<path key={k()} d={`M${tx} ${ty} q -10 -14 -18 6 M${tx} ${ty} q 10 -14 18 6`} stroke="#bfe6ff" strokeWidth={2} fill="none" />); }
      return out;
    }
    case 'statue':
      return [box(x + 0.15, y + 0.15, x + 0.85, y + 0.85, 0, 0.5, faces([200, 206, 214])), box(x + 0.25, y + 0.35, x + 0.75, y + 0.6, 0.5, 0.3, faces([246, 195, 67])), box(x + 0.25, y + 0.62, x + 0.75, y + 0.8, 0.5, 0.38, faces([226, 175, 50]))];
  }
}

/** Christmas lights along the front edges of a finished building's roof. */
function lights(f: Footprint, h: number): ReactNode[] {
  const out: ReactNode[] = [];
  const x0 = f.x + 0.2, x1 = f.x + f.w - 0.25, y0 = f.y + 0.2, y1 = f.y + f.h - 0.3;
  const colors = ['#ff4d4d', '#ffd23f', '#3fd0ff', '#7dff6a'];
  let i = 0;
  for (let x = x0; x <= x1; x += 0.35) { const [px, py] = P(x, y1, h); out.push(<circle key={k()} cx={px} cy={py} r={2.4} fill={colors[i++ % 4]} />); }
  for (let y = y0; y <= y1; y += 0.35) { const [px, py] = P(x1, y, h); out.push(<circle key={k()} cx={px} cy={py} r={2.4} fill={colors[i++ % 4]} />); }
  return out;
}

function christmasTree(x: number, y: number): ReactNode[] {
  const out: ReactNode[] = [];
  const [bx, by] = P(x, y, 0);
  for (let i = 0; i < 3; i++) {
    const [tx, ty] = P(x, y, 2.6 - i * 0.6);
    const w = 0.35 + i * 0.22;
    out.push(<polygon key={k()} points={`${tx},${ty} ${tx - w * TILE},${ty + 0.95 * TILE} ${tx + w * TILE},${ty + 0.95 * TILE}`} fill={['#2e8b57', '#267a4b', '#1f6b41'][i]} />);
  }
  out.push(<rect key={k()} x={bx - 3} y={by - 8} width={6} height={8} fill="#7a5235" />);
  const [sx, sy] = P(x, y, 2.7);
  out.push(<circle key={k()} cx={sx} cy={sy} r={5} fill="#ffd23f" />);
  [[-8, 30, '#ff4d4d'], [9, 42, '#3fd0ff'], [-12, 55, '#ffd23f'], [12, 62, '#ff4d4d'], [0, 48, '#7dff6a']].forEach(([dx, dy, c]) => out.push(<circle key={k()} cx={sx + (dx as number)} cy={sy + (dy as number)} r={3} fill={c as string} />));
  return out;
}

/** A blossoming tree with red and white martenitsas (Баба Марта). */
function martaTree(x: number, y: number): ReactNode[] {
  const out: ReactNode[] = [];
  const [bx, by] = P(x, y, 0);
  out.push(<rect key={k()} x={bx - 3} y={by - 26} width={6} height={26} fill="#7a5235" />);
  const [cx, cy] = P(x, y, 1.6);
  [[0, 0, 22], [-14, 8, 16], [14, 8, 16], [-6, -12, 15], [8, -10, 14]].forEach(([dx, dy, r]) => out.push(<circle key={k()} cx={cx + dx!} cy={cy + dy!} r={r} fill="#f9c6d8" />));
  [[-10, 2], [6, -6], [12, 12], [-4, 14], [0, -14]].forEach(([dx, dy]) => out.push(<circle key={k()} cx={cx + dx!} cy={cy + dy!} r={3} fill="#fff" />));
  // Martenitsas on the branches
  [[-12, 14, '#dc2626'], [-6, 16, '#f8fafc'], [10, 18, '#dc2626'], [16, 16, '#f8fafc']].forEach(([dx, dy, c]) => {
    out.push(<line key={k()} x1={cx + (dx as number)} y1={cy + (dy as number) - 6} x2={cx + (dx as number)} y2={cy + (dy as number) + 4} stroke="#dc2626" strokeWidth={1.2} />);
    out.push(<circle key={k()} cx={cx + (dx as number)} cy={cy + (dy as number) + 6} r={3} fill={c as string} stroke="#94a3b8" strokeWidth={0.5} />);
  });
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
  /** Building (or decoration) being placed or moved. */
  ghost: { type?: BuildingType; decor?: DecorKind; x: number; y: number; valid: boolean } | null;
  selected: BuildingType | null;
  /** Trucks to show on the parking (the members' fleet). */
  parkedTrucks: number;
  /** Material loads driving to the plot right now. */
  incoming: number;
  /** Show the tile grid (placement). */
  grid: boolean;
  /** The company livery: the trucks on the parking wear it. */
  liveryColor?: string | null;
  /** Plot width in tiles (wider after buying land). */
  plotW?: number;
  decor?: (PlacedDecor & { id?: string })[];
  /** Snow in winter; lights and a tree at Christmas. */
  season?: 'winter' | 'christmas' | 'marta' | null;
  /** The decoration picked on the plot (highlighted). */
  selectedDecor?: string | null;
  /** Name and level over every building. */
  labels?: boolean;
  /** Drawing units per screen pixel, so the labels keep their size on a phone and when zoomed. */
  labelScale?: number;
  /** Cars and trucks drive along the streets (off for reduced motion). */
  moving?: boolean;
  /** Evening and night in the base city: lit windows, lamps and headlights. */
  night?: boolean;
  /** Rain (puddles, streaks) or autumn leaves. Snow comes with the winter season. */
  weather?: 'rain' | 'leaves' | null;
  /** Members' trucks that just arrived in the base city, parked in the yard with the driver's name. */
  visitors?: string[];
}

const OUTSIDE_TREES: [number, number][] = [[-1.4, 3], [-2.2, 8], [-1.2, 11], [3, -1.6], [8, -2.2], [11, -1.4], [18.5, 2], [18.2, 8], [19, 11.5], [2, 16.5], [9, 16.8], [13, 16.2], [-3, 16], [-3.5, 0], [6, -3.5], [14.5, -3]];
/** Where the Christmas tree goes: the first free spot by the gate, else along the front fence. */
const XMAS_SPOTS: [number, number][] = [[5.3, 11.3], [7.7, 11.3], [4.2, 11.4], [9, 11.3], [12.6, 11.3], [1.5, 11.4], [12.6, 6.5]];
const EDGE_SPOTS: [number, number][] = [[0.3, 0.3], [0.3, 4.6], [0.3, 6.4], [0.3, 11.4], [3.2, 0.3], [5.3, 0.3], [7.7, 0.3], [12.6, 0.3], [13.6, 2.4], [13.6, 6.6], [13.6, 11.4], [3.0, 11.6], [9.8, 11.6], [5.3, 11.4]];

/** Leaves falling over the plot in autumn (looping). */
function fallingLeaves(): ReactNode[] {
  const colors = ['#d9822b', '#c4562a', '#e0a63a', '#b5482a'];
  return Array.from({ length: 14 }, (_, i) => {
    const x = VIEW.x + 60 + ((i * 337) % (VIEW.w - 120));
    const y = VIEW.y + ((i * 131) % 260);
    const dur = 7 + (i % 5);
    return (
      <ellipse key={`leaf-${i}`} cx={x} cy={y} rx={4} ry={2.2} fill={colors[i % 4]} opacity={0.9}>
        <animateTransform attributeName="transform" type="translate" values={`0 0; ${18 + (i % 3) * 10} 220; ${-6 + (i % 4) * 6} 460`} dur={`${dur}s`} begin={`${-(i * 0.9).toFixed(1)}s`} repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.95;0.95;0" keyTimes="0;0.1;0.85;1" dur={`${dur}s`} begin={`${-(i * 0.9).toFixed(1)}s`} repeatCount="indefinite" />
      </ellipse>
    );
  });
}

export function PlotScene({ buildings, construction, ghost, selected, parkedTrucks, incoming, grid, liveryColor = null, plotW = PLOT.w, decor = [], season = null, selectedDecor = null, labels = true, labelScale = 1, moving = false, night = false, weather = null, visitors = [] }: SceneProps) {
  // Keys are counted from zero on every render, so the same scene gets the same keys.
  // eslint-disable-next-line react-hooks/globals
  uid = 0;
  // eslint-disable-next-line react-hooks/globals
  SNOW = season === 'winter' || season === 'christmas';
  // eslint-disable-next-line react-hooks/globals
  XMAS = season === 'christmas';
  // eslint-disable-next-line react-hooks/globals
  MARTA = season === 'marta';
  // eslint-disable-next-line react-hooks/globals
  NIGHT = night;
  // eslint-disable-next-line react-hooks/globals
  AUTUMN = weather === 'leaves' && !SNOW;
  // eslint-disable-next-line react-hooks/globals
  DIM = false;
  const W = plotW;
  const sx = W - PLOT.w;
  const items: { key: number; node: ReactNode }[] = [];
  const tags: { type: string; x: number; y: number; z: number; text: string; sub: string; active: boolean; visitor?: boolean }[] = [];
  const add = (key: number, node: ReactNode) => items.push({ key, node });
  const fp = (b: { type: BuildingType; x: number; y: number }): Footprint => ({ x: b.x, y: b.y, w: BUILDINGS[b.type].w, h: BUILDINGS[b.type].h });
  const occupied = (x: number, y: number) =>
    buildings.some((b) => { const f = fp(b); return x >= f.x - 0.2 && x <= f.x + f.w + 0.2 && y >= f.y - 0.2 && y <= f.y + f.h + 1.2; }) ||
    decor.some((d) => x >= d.x - 0.3 && x <= d.x + DECOR[d.kind].w + 0.3 && y >= d.y - 0.3 && y <= d.y + DECOR[d.kind].h + 0.3);

  // Ground: fields, streets, sidewalks, the lawn, driveway and yard.
  const ground: ReactNode[] = [];
  ground.push(flat(-8, -8, 24 + sx, 22, 0, SNOW ? 'url(#plot-snowfield)' : 'url(#plot-field)'));
  ground.push(flat(-8, 13, 24 + sx, 15.4, 0, '#646b77'), flat(15 + sx, -8, 17.4 + sx, 13, 0, '#646b77'));
  for (let x = -7; x < 24 + sx; x += 1.6) ground.push(flat(x, 14.15, x + 0.8, 14.25, 0.01, '#f4f1e2'));
  for (let y = -7; y < 13; y += 1.6) ground.push(flat(16.15 + sx, y, 16.25 + sx, y + 0.8, 0.01, '#f4f1e2'));
  ground.push(flat(-8, 12.4, 15 + sx, 13, 0.02, '#c9ccd2'), flat(14.4 + sx, -8, 15 + sx, 13, 0.02, '#c9ccd2'), flat(15 + sx, 12.4, 17.4 + sx, 13, 0.015, '#646b77'));
  ground.push(flat(-8, 0, -0.6, 12, 0.02, SNOW ? '#e3ebf2' : '#8fca7e'), flat(0, -8, W, -0.6, 0.02, SNOW ? '#e3ebf2' : '#8fca7e'));
  ground.push(flat(0, 0, W, PLOT.h, 0.03, SNOW ? 'url(#plot-snow)' : 'url(#plot-lawn)'));
  const dx = PLOT.driveway.x;
  ground.push(flat(dx, PLOT.driveway.yFrom, dx + 1, 12.4, 0.04, '#717884'), flat(dx, PLOT.yardY, W, PLOT.yardY + 1, 0.04, '#717884'));
  for (let y = PLOT.yardY + 1.3; y < 12.3; y += 1.2) ground.push(flat(dx + 0.46, y, dx + 0.54, y + 0.6, 0.05, '#f4f1e2'));
  if (grid) for (let x = 0; x <= W; x++) ground.push(<Line key={k()} a={[x, 0, 0.05]} b={[x, PLOT.h, 0.05]} stroke={SNOW ? 'rgba(80,110,140,0.3)' : 'rgba(255,255,255,0.28)'} w={0.8} />);
  if (grid) for (let y = 0; y <= PLOT.h; y++) ground.push(<Line key={k()} a={[0, y, 0.05]} b={[W, y, 0.05]} stroke={SNOW ? 'rgba(80,110,140,0.3)' : 'rgba(255,255,255,0.28)'} w={0.8} />);
  if (weather === 'rain' && !SNOW) {
    // Puddles on the yard, the lawn and the streets.
    for (const [px, py] of [[8.2, 5.5], [11.5, 5.4], [3, 7.5], [6.5, 9.5], [10.5, 9], [1.5, 13.7], [9, 14.7], [16 + sx, 3], [16.3 + sx, 9]] as [number, number][]) {
      const [cx, cy] = P(px, py, 0.05);
      ground.push(<ellipse key={k()} cx={cx} cy={cy} rx={18} ry={7} fill="rgba(150,180,210,0.55)" />, <ellipse key={k()} cx={cx - 4} cy={cy - 1.5} rx={7} ry={2.2} fill="rgba(255,255,255,0.35)" />);
    }
  }
  add(-100, <g key="ground">{ground}</g>);

  // Fence with the gate on the driveway.
  const fence: ReactNode[] = [];
  for (let x = 0; x <= W; x += 1) if (x < dx - 0.2 || x > dx + 1.2) fence.push(<Line key={k()} a={[x, 12.2, 0]} b={[x, 12.2, 0.55]} stroke="#7c8696" w={1.4} />);
  for (let y = 0; y <= 12.2; y += 1) fence.push(<Line key={k()} a={[W + 0.2, y, 0]} b={[W + 0.2, y, 0.55]} stroke="#7c8696" w={1.4} />);
  fence.push(<Line key={k()} a={[0, 12.2, 0.5]} b={[dx - 0.3, 12.2, 0.5]} stroke="#7c8696" w={1.2} />, <Line key={k()} a={[dx + 1.3, 12.2, 0.5]} b={[W + 0.2, 12.2, 0.5]} stroke="#7c8696" w={1.2} />, <Line key={k()} a={[W + 0.2, 0, 0.5]} b={[W + 0.2, 12.2, 0.5]} stroke="#7c8696" w={1.2} />);
  fence.push(box(dx - 0.3, 12.0, dx, 12.3, 0, 0.9, faces([226, 230, 236])), box(dx + 1, 12.0, dx + 1.3, 12.3, 0, 0.9, faces([226, 230, 236])));
  fence.push(<Line key={k()} a={[dx, 12.15, 0.6]} b={[dx + 0.9, 12.15, 0.6]} stroke="#e04545" w={3} strokeDasharray="6 5" />);
  add(25, <g key="fence">{fence}</g>);

  // Trees, bushes and lamps (none on top of a building).
  // Trees beyond the streets stand in front of the traffic.
  const front: ReactNode[] = [];
  OUTSIDE_TREES.forEach(([x, y], i) => {
    const xx = x > 14 ? x + sx : x;
    const t = tree(xx, y, 0.5 + (i % 3) * 0.08, i);
    if (y > 15.5 || xx > 17.5 + sx) front.push(t);
    else add(xx + y + 0.6, t);
  });
  EDGE_SPOTS.forEach(([x, y], i) => { const xx = x >= 12 ? x + sx : x; if (!occupied(xx, y)) add(xx + y + 0.6, i % 3 === 2 ? bush(xx, y) : tree(xx, y, 0.45 + (i % 2) * 0.08, i)); });
  for (let x = 1; x < 15 + sx; x += 3.2) add(x + 12.8, lamp(x, 12.8));
  for (let y = 1; y < 13; y += 3.2) add(14.7 + sx + y, lamp(14.7 + sx, y));

  // Traffic on the two streets (drawn over the plot, under the trees beyond the streets).
  const road = 32 + sx;
  // eslint-disable-next-line react-hooks/globals
  DIM = NIGHT;
  const traffic: ReactNode[] = [
    // The side street: towards the main road and back.
    driving((x, y) => car(x, y, [47, 123, 255], false, true), [16.45 + sx, 16 - 1.3], 'y', -24, 20, 0.15, moving),
    driving((x, y) => car(x, y, [246, 195, 67], false), [15.45 + sx, -8], 'y', 24, 18, 0.45, moving),
  ];
  // The far lane of the main road (unless material loads stand there at the gate).
  if (!incoming) traffic.push(
    driving((x, y) => car(x, y, [47, 210, 122], true, true), [24 + sx - 1.3, 13.3], 'x', -road, 30, 0.3, moving),
    driving((x, y) => car(x, y, [166, 107, 255], true, true), [24 + sx - 1.3, 13.3], 'x', -road, 30, 0.78, moving),
  );
  traffic.push(
    driving((x, y) => car(x, y, [224, 69, 69]), [-8, 14.55], 'x', road, 30, 0.55, moving),
    driving((x, y) => car(x, y, [235, 240, 246]), [-8, 14.55], 'x', road, 30, 0.2, moving),
    driving((x, y) => truck(x, y, { cab: [235, 240, 246], body: [47, 123, 255], rigid: true, along: 'x' }), [-8, 14.45], 'x', road, 30, 0.88, moving),
  );
  // eslint-disable-next-line react-hooks/globals
  DIM = false;

  // Members' trucks that just arrived, parked along the yard with the driver's name.
  const yardSpots = Math.max(0, Math.floor((W - PLOT.driveway.x - 1.2) / 3.1));
  visitors.slice(0, Math.min(3, yardSpots)).forEach((name, i) => {
    const vx = PLOT.driveway.x + 1.1 + i * 3.1, vy = PLOT.yardY + 0.05;
    const rgb = liveryColor ? ([1, 3, 5].map((j) => parseInt(liveryColor.slice(j, j + 2), 16)) as [number, number, number]) : ([47, 123, 255] as [number, number, number]);
    add(vx + vy + 3, truck(vx, vy, { cab: rgb, body: [235, 240, 246], rigid: true, along: 'x' }));
    if (labels) tags.push({ type: `visit-${i}`, x: vx + 1.4, y: vy + 0.45, z: 1.5, text: name, sub: 'пристигна', active: false, visitor: true });
  });

  // Material loads arriving at the gate.
  for (let i = 0; i < Math.min(2, incoming); i++) {
    const x = 1.2 - i * 5.5, y = 13.35;
    add(y + x + 20, truck(x, y - 0.02, { cab: [34, 211, 238], body: [90, 96, 110], along: 'x', load: [[200, 200, 196], [196, 106, 74]] }));
  }

  // Buildings and the construction site.
  for (const b of buildings) {
    const f = fp(b);
    const building = construction && construction.type === b.type ? construction : null;
    const node: ReactNode[] = [];
    const finished = (lvl: number) => (b.type === 'office' ? office(f, lvl) : b.type === 'logistics' ? logistics(f, lvl) : b.type === 'training' ? training(f, lvl) : b.type === 'service' ? service(f, lvl) : b.type === 'warehouse' ? warehouse(f, lvl) : b.type === 'rest' ? rest(f, lvl) : b.type === 'factory' ? factory(f, lvl) : b.type === 'fuel' ? fuelStation(f, lvl) : b.type === 'polygon' ? polygon(f, lvl) : b.type === 'museum' ? museum(f, lvl) : parking(f, lvl, parkedTrucks, liveryColor));
    if (building && b.level === 0) node.push(...site(f, b.type, building.status, building.progress, building.delivered, null));
    else if (building) node.push(...site(f, b.type, building.status, building.progress, building.delivered, finished(b.level)));
    else if (b.level > 0) node.push(...finished(b.level));
    if (selected === b.type) node.unshift(flat(f.x - 0.1, f.y - 0.1, f.x + f.w + 0.1, f.y + f.h + 0.1, 0.06, 'rgba(34,211,238,0.22)', { stroke: '#22d3ee', strokeWidth: 2 }));
    add(f.x + f.w + f.y + f.h - 0.5, <g key={`b-${b.type}`} data-building={b.type}>{node}</g>);
    if (labels) {
      const lvl = building ? (b.level === 0 ? 'строи се' : `ниво ${b.level} → ${b.level + 1}`) : b.level > 0 ? `ниво ${b.level}` : null;
      const h = b.level > 0 ? buildingHeight(b.type, b.level) : building?.status === 'building' ? 1.2 : 0.4;
      if (lvl) tags.push({ type: b.type, x: f.x + f.w / 2, y: f.y + f.h / 2, z: h + (b.type === 'training' ? 0.7 : 0.25), text: BUILDINGS[b.type].label, sub: lvl, active: selected === b.type });
    }
    if (building?.status === 'building' && b.type !== 'parking') add(f.x + f.y + 1, <g key={`crane-${b.type}`}>{crane(f.x - 0.4, f.y + 0.2, Math.max(3.5, f.h + 1.5))}</g>);
  }

  // Decorations, and the season.
  for (const d of decor) {
    const sel = !!d.id && d.id === selectedDecor;
    add(d.x + DECOR[d.kind].w + d.y + DECOR[d.kind].h - 0.4, <g key={k()}>{sel && flat(d.x - 0.05, d.y - 0.05, d.x + DECOR[d.kind].w + 0.05, d.y + DECOR[d.kind].h + 0.05, 0.06, 'rgba(34,211,238,0.25)', { stroke: '#22d3ee', strokeWidth: 2 })}{decoration(d, liveryColor)}</g>);
  }
  if (XMAS) {
    for (const b of buildings) if (b.level > 0 && b.type !== 'parking' && !(construction && construction.type === b.type)) add(fp(b).x + fp(b).w + fp(b).y + fp(b).h - 0.45, <g key={k()}>{lights(fp(b), buildingHeight(b.type, b.level))}</g>);
    const spot = XMAS_SPOTS.map(([x, y]): [number, number] => [x >= 12 ? x + sx : x, y]).find(([x, y]) => !occupied(x, y));
    if (spot) add(spot[0] + spot[1] + 0.2, <g key="xmas-tree">{christmasTree(spot[0], spot[1])}</g>);
  }
  if (MARTA) {
    const spot = XMAS_SPOTS.map(([x, y]): [number, number] => [x >= 12 ? x + sx : x, y]).find(([x, y]) => !occupied(x, y));
    if (spot) add(spot[0] + spot[1] + 0.2, <g key="marta-tree">{martaTree(spot[0], spot[1])}</g>);
  }

  // The building (or decoration) being placed.
  if (ghost) {
    const def = ghost.type ? BUILDINGS[ghost.type] : DECOR[ghost.decor!];
    const col = ghost.valid ? '34,211,238' : '224,69,69';
    const h = ghost.type ? Math.max(0.4, buildingHeight(ghost.type, 1)) : 0.4;
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
        <pattern id="plot-snow" width="24" height="24" patternUnits="userSpaceOnUse">
          <rect width="24" height="24" fill="#eef4f9" />
          <circle cx="5" cy="6" r="1.4" fill="#ffffff" />
          <circle cx="17" cy="14" r="1.2" fill="#dbe6ef" />
          <circle cx="10" cy="20" r="1.1" fill="#ffffff" />
        </pattern>
        <pattern id="plot-snowfield" width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#e3ebf2" />
          <circle cx="7" cy="9" r="1.4" fill="#f5f9fc" />
          <circle cx="22" cy="23" r="1.4" fill="#d3dee8" />
        </pattern>
        <radialGradient id="plot-glow">
          <stop offset="0" stopColor="#ffd84a" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffcf40" stopOpacity="0" />
        </radialGradient>
        {/* Night: everything dark and blue, except the warm lights (LIT), which keep their colour and glow a little. */}
        <filter id="plot-night" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix" values="0.24 0 0 0 0.01  0 0.28 0 0 0.02  0.04 0.05 0.42 0 0.07  0 0 0 1 0" result="dark" />
          <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3 6 -7.5 0 -4.65" result="mask" />
          <feComposite in="SourceGraphic" in2="mask" operator="in" result="lights" />
          <feGaussianBlur in="lights" stdDeviation="3" result="bloom" />
          <feMerge>
            <feMergeNode in="dark" />
            <feMergeNode in="bloom" />
            <feMergeNode in="lights" />
          </feMerge>
        </filter>
        <pattern id="plot-rain" width="36" height="60" patternUnits="userSpaceOnUse">
          <path d="M6 0 l-5 14 M24 22 l-5 14 M14 40 l-5 14 M32 48 l-4 11" stroke="rgba(210,225,245,0.55)" strokeWidth={1.3} strokeLinecap="round" />
          {moving && <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="-20 60" dur="0.55s" repeatCount="indefinite" />}
        </pattern>
        <linearGradient id="plot-sun" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff6d6" stopOpacity="0.28" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g filter={NIGHT ? 'url(#plot-night)' : undefined}>
        <rect width={VIEW.w * 4} height={VIEW.h * 4} x={-VIEW.w} y={-VIEW.h} fill={SNOW ? '#e3ebf2' : '#9fd48c'} />
        {items.map((i) => i.node)}
      </g>
      <g pointerEvents="none">{traffic}</g>
      <g filter={NIGHT ? 'url(#plot-night)' : undefined}>{front}</g>
      {weather === 'rain' && !SNOW && (
        <g pointerEvents="none">
          <rect width={VIEW.w * 4} height={VIEW.h * 4} x={-VIEW.w} y={-VIEW.h} fill="rgba(60,72,92,0.16)" />
          <rect width={VIEW.w * 4} height={VIEW.h * 4} x={-VIEW.w} y={-VIEW.h} fill="url(#plot-rain)" />
        </g>
      )}
      {AUTUMN && moving && <g pointerEvents="none">{fallingLeaves()}</g>}
      {tags.map((t) => {
        const [px, py] = P(t.x, t.y, t.z);
        const w = Math.max(t.text.length, t.sub.length) * 7 + 22;
        return (
          <g key={`tag-${t.type}`} data-building={t.visitor ? undefined : t.type} transform={`translate(${px.toFixed(1)} ${(py - 8).toFixed(1)}) scale(${labelScale.toFixed(3)}) translate(0 -22)`} className="cursor-pointer">
            <path d={`M${-w / 2} -16 h${w} a6 6 0 0 1 6 6 v20 a6 6 0 0 1 -6 6 h${-w / 2 + 6} l-6 6 l-6 -6 h${-w / 2 + 6} a6 6 0 0 1 -6 -6 v-20 a6 6 0 0 1 6 -6 z`} fill={t.active ? 'rgba(8,47,73,0.92)' : t.visitor ? 'rgba(30,58,138,0.85)' : 'rgba(10,14,22,0.82)'} stroke={t.active ? '#22d3ee' : 'rgba(255,255,255,0.18)'} strokeWidth={1} />
            <text x={0} y={-2} textAnchor="middle" fontSize={12} fontWeight={700} fill="#ffffff" fontFamily="inherit">{t.text}</text>
            <text x={0} y={12} textAnchor="middle" fontSize={10.5} fill={t.visitor ? '#a7f3d0' : t.sub.startsWith('ниво') && !t.sub.includes('→') ? '#f6c343' : '#7dd3fc'} fontFamily="inherit">{t.sub}</text>
          </g>
        );
      })}
      {!NIGHT && <rect width={VIEW.w * 3} height={VIEW.h * 3} x={-VIEW.w} y={-VIEW.h} fill="url(#plot-sun)" pointerEvents="none" />}
    </>
  );
}
