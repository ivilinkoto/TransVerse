/**
 * 1.2.3.5: the player's truck in 3D, built from the catalogue (kind, cab, axles,
 * brand look), with its paint, parts, tuning and wear. 1 unit = 1 m, facing +x.
 *
 * The cab is a smooth shell extruded from a side profile (rake, roof, rounded edges),
 * painted with a clear-coat; the wheels are lathed tyres on steel or alloy rims; the
 * chassis carries tanks, guards, mudguards and lights; the trailers have their own
 * bodies (curtain folds, corrugated containers, polished tanks, wooden decks) with
 * contour marking. Original, stylised designs for the game's fictional brands.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { GRILLE_COLORS, LIGHT_COLORS, type Cosmetics } from '@/lib/game/cosmetics';
import type { Tuning } from '@/lib/game/garage';
import { badgeTexture, clusterTexture, contourTexture, corrugatedNormal, curtainNormal, fabricTexture, navTexture, plateTexture, textTexture, treadTexture, woodTexture } from './textures';

type GrilleKind = 'slats-h' | 'slats-v' | 'mesh' | 'closed';
type LightKind = 'rect' | 'round' | 'slim' | 'quad';

/** Each fictional brand has its own face. */
const BRAND_STYLE: Record<string, { grille: GrilleKind; lights: LightKind; rake: number; nose: number; accent: string }> = {
  Danubia: { grille: 'slats-h', lights: 'rect', rake: 0.22, nose: 0.06, accent: '#1e3a8a' },
  'Hemus Trucks': { grille: 'mesh', lights: 'rect', rake: 0.12, nose: 0.03, accent: '#334155' },
  'Iskar Steel': { grille: 'slats-v', lights: 'slim', rake: 0.3, nose: 0.08, accent: '#7f1d1d' },
  'Rila Heavy': { grille: 'slats-v', lights: 'quad', rake: 0.14, nose: 0.05, accent: '#713f12' },
  'Balkan Motors': { grille: 'slats-h', lights: 'round', rake: 0.18, nose: 0.05, accent: '#14532d' },
  'Volta Motors': { grille: 'closed', lights: 'slim', rake: 0.34, nose: 0.1, accent: '#0e7490' },
};
const DEFAULT_STYLE = BRAND_STYLE.Danubia!;
export const RIM_COLORS: Record<string, string> = { steel: '#c3c9d1', alloy: '#e2e6eb', chrome: '#f8fafc', black: '#15181d' };

// ---------------------------------------------------------------- materials

export const M = {
  rubber: () => new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.92, metalness: 0, map: treadTexture() }),
  sidewall: () => new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.85 }),
  plastic: () => new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.75, metalness: 0.05 }),
  frame: () => new THREE.MeshStandardMaterial({ color: '#1a1d22', roughness: 0.6, metalness: 0.4 }),
  alu: () => new THREE.MeshStandardMaterial({ color: '#d5dae0', roughness: 0.32, metalness: 0.9 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.08, metalness: 1 }),
  steel: () => new THREE.MeshStandardMaterial({ color: '#6b7280', roughness: 0.5, metalness: 0.7 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: '#0d1620', roughness: 0.03, metalness: 0.2, transparent: true, opacity: 0.6, envMapIntensity: 1.6, clearcoat: 1, side: THREE.DoubleSide }),
  lens: () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, metalness: 0, transparent: true, opacity: 0.12, clearcoat: 1 }),
  white: () => new THREE.MeshPhysicalMaterial({ color: '#eef1f4', roughness: 0.35, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
};

export function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, ...opts });
}

function paintMat(color: string, condition: number) {
  // Clear-coated paint; dust dulls and greys it as the condition drops.
  const dirt = condition < 85 ? (85 - condition) / 130 : 0;
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color).lerp(new THREE.Color('#8f8473'), dirt),
    metalness: 0.45,
    roughness: 0.3 + dirt * 0.5,
    clearcoat: Math.max(0.15, 1 - dirt * 1.6),
    clearcoatRoughness: 0.06 + dirt * 0.4,
  });
}

export function emissive(color: string, on: number) {
  return new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: on, roughness: 0.2 });
}

// ---------------------------------------------------------------- helpers

export function box(w: number, h: number, d: number, m: THREE.Material, r = 0.04) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function cyl(rTop: number, rBottom: number, h: number, m: THREE.Material, seg = 24) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A flat panel (plane) facing +z, for textures stuck on a surface. */
function decalPlane(w: number, h: number, m: THREE.Material) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  p.receiveShadow = true;
  return p;
}

export const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => {
  o.position.set(x, y, z);
  return o;
};

// ---------------------------------------------------------------- wheels

/** A tyre on a rim, axis along z, outer face toward `side`. */
export function wheel(radius: number, width: number, rimColor: string, side: number, opts: { dual?: boolean; trailer?: boolean } = {}) {
  const g = new THREE.Group();
  const rimR = radius * 0.6;
  const prof: THREE.Vector2[] = [];
  const hw = width / 2;
  const shoulder = Math.min(0.07, width * 0.2);
  prof.push(new THREE.Vector2(rimR, -hw + 0.02));
  prof.push(new THREE.Vector2(radius - shoulder * 1.4, -hw));
  prof.push(new THREE.Vector2(radius - shoulder * 0.35, -hw + shoulder * 0.4));
  prof.push(new THREE.Vector2(radius, -hw + shoulder));
  prof.push(new THREE.Vector2(radius, hw - shoulder));
  prof.push(new THREE.Vector2(radius - shoulder * 0.35, hw - shoulder * 0.4));
  prof.push(new THREE.Vector2(radius - shoulder * 1.4, hw));
  prof.push(new THREE.Vector2(rimR, hw - 0.02));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, 56), M.rubber());
  tyre.rotation.x = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);
  // The rim: a dish with ten nuts, a hub and hand holes (steel) or spokes (alloy).
  const rim = new THREE.MeshStandardMaterial({ color: rimColor, roughness: rimColor === RIM_COLORS.black ? 0.4 : 0.18, metalness: 0.9 });
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR * 0.96, width - 0.06, 40, 1, true), rim);
  dish.rotation.x = Math.PI / 2;
  g.add(dish);
  const face = new THREE.Mesh(new THREE.CircleGeometry(rimR * 0.97, 40), rim);
  face.position.z = side * (hw - 0.05);
  if (side < 0) face.rotation.y = Math.PI;
  g.add(face);
  const dark = new THREE.MeshStandardMaterial({ color: '#0e1013', roughness: 0.7 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(rimR * 0.13, 16), dark);
    hole.position.set(Math.cos(a) * rimR * 0.62, Math.sin(a) * rimR * 0.62, side * (hw - 0.045));
    if (side < 0) hole.rotation.y = Math.PI;
    g.add(hole);
  }
  const hub = cyl(rimR * 0.32, rimR * 0.36, 0.08, M.steel(), 20);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = side * (hw - 0.02);
  g.add(hub);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const nut = cyl(0.018, 0.018, 0.05, M.chrome(), 6);
    nut.rotation.x = Math.PI / 2;
    nut.position.set(Math.cos(a) * rimR * 0.4, Math.sin(a) * rimR * 0.4, side * (hw - 0.01));
    g.add(nut);
  }
  if (!opts.trailer) {
    const cap = cyl(rimR * 0.16, rimR * 0.22, 0.06, M.chrome(), 16);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = side * (hw + 0.02);
    g.add(cap);
  }
  return g;
}

interface WheelSet {
  wheels: THREE.Object3D[];
}

function axle(group: THREE.Group, x: number, track: number, radius: number, kind: 'steer' | 'drive' | 'trailer' | 'van', rimColor: string, set: WheelSet) {
  const width = kind === 'trailer' ? 0.38 : kind === 'van' ? 0.22 : 0.31;
  const dual = kind === 'drive';
  for (const side of [-1, 1]) {
    const outer = wheel(radius, width, rimColor, side, { trailer: kind === 'trailer' });
    outer.position.set(x, radius, side * (track / 2));
    group.add(outer);
    set.wheels.push(outer);
    if (dual) {
      const inner = wheel(radius, width, rimColor, side);
      inner.position.set(x, radius, side * (track / 2 - width - 0.03));
      group.add(inner);
      set.wheels.push(inner);
    }
  }
  const beam = cyl(0.07, 0.07, track - 0.3, M.frame(), 12);
  beam.rotation.x = Math.PI / 2;
  beam.position.set(x, radius, 0);
  group.add(beam);
  if (kind === 'drive') {
    const diff = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), M.frame());
    diff.position.set(x, radius, 0);
    group.add(diff);
  }
}

/** A plastic mudguard over a wheel: an arc over the top ('top') or over the top and the back ('rear'). */
function mudguard(x: number, radius: number, width: number, z: number, mode: 'top' | 'rear' = 'top') {
  // After turning the cylinder's axis to z, theta = pi/2 is the front, pi the top, 3pi/2 the back.
  const start = mode === 'top' ? Math.PI * 0.6 : Math.PI * 0.68;
  const len = mode === 'top' ? Math.PI * 0.8 : Math.PI * 0.95;
  const geo = new THREE.CylinderGeometry(radius + 0.08, radius + 0.08, width + 0.06, 32, 1, true, start, len);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.65, side: THREE.DoubleSide }));
  m.rotation.x = Math.PI / 2;
  m.position.set(x, radius, z);
  m.castShadow = true;
  return m;
}

function mudflap(x: number, z: number, h = 0.55) {
  const f = box(0.02, h, 0.5, new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.9 }), 0.005);
  f.position.set(x, 0.12 + h / 2, z);
  return f;
}

function rearLights(group: THREE.Group, x: number, y: number, halfW: number, night: boolean) {
  for (const side of [-1, 1]) {
    const housing = box(0.06, 0.16, 0.48, M.plastic(), 0.02);
    group.add(at(housing, x, y, side * (halfW - 0.3)));
    const parts: [string, number][] = [['#f59e0b', -0.15], ['#dc2626', 0], ['#f1f5f9', 0.15]];
    for (const [c, dz] of parts) {
      const l = box(0.02, 0.11, 0.13, emissive(c, c === '#dc2626' ? (night ? 1.6 : 0.5) : 0.15), 0.01);
      group.add(at(l, x - 0.03, y, side * (halfW - 0.3) + dz * side));
    }
  }
}

function contourStrip(length: number, colour: 'red' | 'yellow' = 'red') {
  const tex = contourTexture(colour).clone();
  tex.needsUpdate = true;
  tex.repeat.set(Math.max(1, Math.round(length / 1.2)), 1);
  return decalPlane(length, 0.05, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.08 }));
}

function extrude(shape: THREE.Shape, width: number, m: THREE.Material, bevel = 0.07) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 18 });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- the cab shell (a loft)

/**
 * One horizontal section of the cab: a rounded rectangle in plan view at height `y`.
 * `xf` is the front face, `xb` the back wall (x forward), `h` the half width,
 * `rf` / `rb` the radii of the front and back corners.
 */
interface Ring {
  y: number;
  xf: number;
  xb: number;
  h: number;
  rf: number;
  rb: number;
}

/** Fractions of the perimeter given to each piece, so every ring has its vertices in the same places. */
const SEG = [0.08, 0.08, 0.25, 0.05, 0.08, 0.05, 0.25, 0.08, 0.08];
const SEG_START = SEG.map((_, i) => SEG.slice(0, i).reduce((a, b) => a + b, 0));

/** A point on the ring at perimeter parameter s (0 = middle of the front, going toward +z first). */
function ringPoint(r: Ring, s: number, grow = 0): [number, number] {
  const u = ((s % 1) + 1) % 1;
  let i = SEG.length - 1;
  while (i > 0 && u < SEG_START[i]!) i--;
  const t = (u - SEG_START[i]!) / SEG[i]!;
  const xf = r.xf + grow;
  const xb = r.xb - grow;
  const h = r.h + grow;
  const rf = r.rf + grow;
  const rb = r.rb + grow;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  switch (i) {
    case 0: return [xf, lerp(0, h - rf)];
    case 1: { const a = (t * Math.PI) / 2; return [xf - rf + Math.cos(a) * rf, h - rf + Math.sin(a) * rf]; }
    case 2: return [lerp(xf - rf, xb + rb), h];
    case 3: { const a = Math.PI / 2 + (t * Math.PI) / 2; return [xb + rb + Math.cos(a) * rb, h - rb + Math.sin(a) * rb]; }
    case 4: return [xb, lerp(h - rb, -(h - rb))];
    case 5: { const a = Math.PI + (t * Math.PI) / 2; return [xb + rb + Math.cos(a) * rb, -(h - rb) + Math.sin(a) * rb]; }
    case 6: return [lerp(xb + rb, xf - rf), -h];
    case 7: { const a = Math.PI * 1.5 + (t * Math.PI) / 2; return [xf - rf + Math.cos(a) * rf, -(h - rf) + Math.sin(a) * rf]; }
    default: return [xf, lerp(-(h - rf), 0)];
  }
}

/** The ring at any height, by linear interpolation between the defined ones. */
function ringAt(rings: Ring[], y: number): Ring {
  if (y <= rings[0]!.y) return rings[0]!;
  for (let i = 1; i < rings.length; i++) {
    const a = rings[i - 1]!;
    const b = rings[i]!;
    if (y <= b.y) {
      const t = (y - a.y) / (b.y - a.y);
      const l = (p: number, q: number) => p + (q - p) * t;
      return { y, xf: l(a.xf, b.xf), xb: l(a.xb, b.xb), h: l(a.h, b.h), rf: l(a.rf, b.rf), rb: l(a.rb, b.rb) };
    }
  }
  return rings[rings.length - 1]!;
}

/**
 * The cab shell: sections joined into a smooth surface, closed with a domed roof.
 * `holes` leaves the window openings empty (the glass sits in them); `grow` offsets
 * the surface (a negative one gives the inner trim); `extraY` adds sections at the
 * window edges so the openings are cut cleanly.
 */
function loftGeometry(rings: Ring[], n = 180, steps = 3, opts: { holes?: (s: number, y: number, r: Ring) => boolean; grow?: number; extraY?: number[] } = {}) {
  const ys = new Set<number>();
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < steps; k++) ys.add(rings[i]!.y + ((rings[i + 1]!.y - rings[i]!.y) * k) / steps);
  ys.add(rings[rings.length - 1]!.y);
  for (const y of opts.extraY ?? []) if (y > rings[0]!.y && y < rings[rings.length - 1]!.y) ys.add(y);
  const all = [...ys].sort((p, q) => p - q).map((y) => ringAt(rings, y));
  const grow = opts.grow ?? 0;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of all) for (let j = 0; j < n; j++) {
    const [x, z] = ringPoint(r, j / n, grow);
    pos.push(x, r.y, z);
  }
  for (let i = 0; i < all.length - 1; i++) {
    const midY = (all[i]!.y + all[i + 1]!.y) / 2;
    const mid = ringAt(rings, midY);
    for (let j = 0; j < n; j++) {
      if (opts.holes) {
        let sm = (j + 0.5) / n;
        if (sm > 0.5) sm -= 1;
        if (opts.holes(sm, midY, mid)) continue;
      }
      const a = i * n + j;
      const b = i * n + ((j + 1) % n);
      const c = (i + 1) * n + j;
      const d = (i + 1) * n + ((j + 1) % n);
      idx.push(a, c, b, b, c, d);
    }
  }
  const top = all[all.length - 1]!;
  const centre = pos.length / 3;
  pos.push((top.xf + top.xb) / 2, top.y + 0.04 + grow, 0);
  const base = (all.length - 1) * n;
  for (let j = 0; j < n; j++) idx.push(base + j, centre, base + ((j + 1) % n));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A patch lying on the shell (glass, door seams, decals): s range and height range, `grow` m off the surface. */
function shellPatch(rings: Ring[], y0: number, y1: number, sRange: (r: Ring) => [number, number], grow: number, m: THREE.Material, ns = 24, ny = 6) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= ny; i++) {
    const r = ringAt(rings, y0 + ((y1 - y0) * i) / ny);
    const [s0, s1] = sRange(r);
    for (let j = 0; j <= ns; j++) {
      const s = s0 + ((s1 - s0) * j) / ns;
      const [x, z] = ringPoint(r, s, grow);
      pos.push(x, r.y, z);
      uv.push(j / ns, i / ny);
    }
  }
  for (let i = 0; i < ny; i++) for (let j = 0; j < ns; j++) {
    const a = i * (ns + 1) + j;
    const b = a + 1;
    const c = a + ns + 1;
    const d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}

/** Perimeter parameter of a point at x on the right (+z) or left (-z) side of a ring. */
function sideS(r: Ring, x: number, side: number) {
  const a = r.xf - r.rf;
  const b = r.xb + r.rb;
  const t = Math.min(1, Math.max(0, (a - x) / (a - b)));
  return side > 0 ? SEG_START[2]! + SEG[2]! * t : SEG_START[6]! + SEG[6]! * (1 - t);
}

/** A bent tube through points (mirror arms, bull bar, coiled air lines). */
function tube(points: THREE.Vector3[], r: number, m: THREE.Material, segments = 40, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, r, 10, closed), m);
  mesh.castShadow = true;
  return mesh;
}

export interface TruckLook {
  modelId: string;
  color: string;
  cosmetics?: Cosmetics | null;
  tuning?: Tuning | null;
  /** 0–100: below 85 the truck gets dusty, below 55 scratched, below 35 rusty. */
  condition?: number;
  night?: boolean;
  trailerModelId?: string | null;
  trailerColor?: string | null;
  plate?: string | null;
  company?: string | null;
}

export interface BuiltTruck {
  group: THREE.Group;
  /** Length of the whole combination (m). */
  length: number;
  wheels: THREE.Object3D[];
  /** Tuning meshes by part (to drop them in when fitted). */
  parts: Map<string, THREE.Object3D[]>;
  /** Driver's eye in the truck's own coordinates. */
  eye: THREE.Vector3;
  cab: { frontX: number; length: number; height: number; width: number; floorY: number };
}

/**
 * The power unit (and a trailer when given). Built with the front face at x = 0 and
 * then centred. Dimensions follow a modern European cab-over tractor: cab 2.49 m wide
 * and 2.3 m long (sleeper), front overhang 1.4 m, wheelbase 3.7 m (4x2), tyres
 * 315/80 R22.5 (Ø 1.08 m), frame top at 1.0 m, fifth wheel at 1.2 m.
 */
export function buildTruck(look: TruckLook): BuiltTruck {
  const unit = powerUnitModel(look.modelId);
  if (unit.kind === 'van' && unit.look !== 'box-van') return buildVan(look);
  const baseStyle = BRAND_STYLE[unit.brand] ?? DEFAULT_STYLE;
  const classic = unit.look === 'classic';
  // The older model: a nearly upright split windscreen, round lamps, chrome.
  const style = classic ? { ...baseStyle, rake: 0.03, lights: 'round' as LightKind, grille: 'slats-h' as GrilleKind } : baseStyle;
  const electric = !!unit.electric;
  // Lighter trucks are built to the same drawings at a smaller scale: a 7.2 t box truck at 80 %,
  // a 12 t rigid at 90 % (cab ~2.2 m wide, 19.5" wheels), heavy trucks at full size.
  const lightTruck = unit.look === 'box-van';
  const sc = lightTruck ? 0.8 : unit.kind === 'rigid' && unit.payloadTons <= 7.5 && !electric ? 0.9 : 1;
  const tuning = look.tuning ?? look.cosmetics?.tuning ?? {};
  const cosmetics = look.cosmetics ?? {};
  const condition = look.condition ?? 100;
  const night = !!look.night;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const set: WheelSet = { wheels: [] };
  const parts = new Map<string, THREE.Object3D[]>();
  const addPart = (part: string, objs: THREE.Object3D[]) => {
    for (const o of objs) body.add(o);
    parts.set(part, objs);
  };
  const paint = paintMat(look.color, condition);
  const plate = look.plate ?? 'TV 0000 BG';
  const lift = tuning.stance === 'low' ? -0.08 : tuning.stance === 'high' ? 0.12 : 0;
  body.position.y = lift;
  const rimColor = RIM_COLORS[tuning.rims ?? 'steel'] ?? RIM_COLORS.steel!;
  const R = 0.54; // tyre radius
  const tractor = unit.kind === 'tractor';

  // ---- cab dimensions
  const day = unit.cab === 'day';
  const cabL = day ? 2.05 : 2.3;
  const W = 2.49;
  const hw = W / 2;
  const y0 = 1.12; // lower edge of the cab sides
  const belt = 2.06; // bottom of the windscreen
  const roofY = unit.cab === 'highline' ? 3.85 : day ? 2.98 : 3.32;
  const wsTop = Math.min(roofY - 0.24, 3.08);
  const rake = style.rake * 0.9;
  const cr = classic ? 0.45 : 1;
  const rings: Ring[] = [
    { y: y0, xf: 0, xb: -cabL, h: hw - 0.01, rf: 0.2 * cr, rb: 0.07 },
    { y: belt - 0.06, xf: 0, xb: -cabL, h: hw, rf: 0.24 * cr, rb: 0.08 },
    { y: belt, xf: -0.02, xb: -cabL, h: hw - 0.005, rf: 0.28 * cr, rb: 0.08 },
    { y: wsTop, xf: -0.03 - rake, xb: -cabL, h: hw - 0.04, rf: 0.36 * cr, rb: 0.1 },
  ];
  if (roofY - wsTop > 0.5) rings.push({ y: wsTop + 0.18, xf: -0.06 - rake, xb: -cabL, h: hw - 0.05, rf: 0.36 * cr, rb: 0.1 }, { y: roofY - 0.1, xf: -0.2 - rake, xb: -cabL + 0.01, h: hw - 0.07, rf: 0.4 * cr, rb: 0.12 });
  else rings.push({ y: roofY - 0.08, xf: -0.1 - rake, xb: -cabL, h: hw - 0.06, rf: 0.38 * cr, rb: 0.12 });
  rings.push({ y: roofY, xf: -0.26 - rake, xb: -cabL + 0.07, h: hw - 0.16, rf: 0.42 * cr, rb: 0.16 });
  const glass = M.glass();
  const dark = new THREE.MeshStandardMaterial({ color: '#07090c', roughness: 0.6, side: THREE.DoubleSide });
  const seam = new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.8, side: THREE.DoubleSide });
  // Window openings: the windscreen wraps round the front corners; a side window in each door.
  const doorFront = -0.52;
  const doorBack = day ? -1.72 : -1.62;
  const wsRange = (r: Ring): [number, number] => {
    const k = Math.min(0.06, 0.035 + (r.rf - 0.28) * 0.2);
    return [-(SEG[0]! + k), SEG[0]! + k];
  };
  const winRange = (r: Ring, side: number): [number, number] => {
    const front = sideS(r, r.xf - r.rf - 0.1, side);
    const back = sideS(r, doorBack + 0.06, side);
    return side > 0 ? [front, back] : [back, front];
  };
  const winLow = belt + 0.02;
  const winTop = wsTop - 0.08;
  const holes = (sm: number, y: number, r: Ring) => {
    if (y > belt + 0.005 && y < wsTop - 0.005) {
      const [a, b] = wsRange(r);
      if (sm > a + 0.004 && sm < b - 0.004) return true;
    }
    if (y > winLow + 0.01 && y < winTop - 0.01) for (const side of [-1, 1]) {
      let [a, b] = winRange(r, side);
      if (a > 0.5) a -= 1;
      if (b > 0.5) b -= 1;
      if (sm > a + 0.003 && sm < b - 0.003) return true;
    }
    return false;
  };
  const extraY = [belt, belt + 0.005, wsTop, wsTop - 0.005, winLow, winLow + 0.01, winTop, winTop - 0.01];
  const shell = new THREE.Mesh(loftGeometry(rings, 180, 3, { holes, extraY }), paint);
  shell.castShadow = true;
  shell.receiveShadow = true;
  body.add(shell);
  // Inner trim: the same shape 4 cm in, seen from inside (lower part darker comes from the panels).
  const trimIn = new THREE.Mesh(loftGeometry(rings, 180, 3, { holes, extraY, grow: -0.04 }), new THREE.MeshStandardMaterial({ color: '#4b525c', roughness: 0.95, side: THREE.BackSide, envMapIntensity: 0.35 }));
  trimIn.receiveShadow = true;
  body.add(trimIn);
  // The rubber surround of the windscreen and the window seals.
  // A frame, not a panel: bands along the top and bottom, strips up the sides.
  const frame = (y0f: number, y1f: number, range: (r: Ring) => [number, number], m = 0.008, band = 0.045) => {
    const parts3: THREE.Mesh[] = [];
    parts3.push(shellPatch(rings, y0f - 0.035, y0f + band - 0.035, (r) => { const [a, b] = range(r); return [a - m, b + m]; }, 0.003, dark, 40, 1));
    parts3.push(shellPatch(rings, y1f + 0.035 - band, y1f + 0.035, (r) => { const [a, b] = range(r); return [a - m, b + m]; }, 0.003, dark, 40, 1));
    parts3.push(shellPatch(rings, y0f - 0.035, y1f + 0.035, (r) => { const [a] = range(r); return [a - m, a + 0.002]; }, 0.003, dark, 2, 6));
    parts3.push(shellPatch(rings, y0f - 0.035, y1f + 0.035, (r) => { const [, b] = range(r); return [b - 0.002, b + m]; }, 0.003, dark, 2, 6));
    for (const p3 of parts3) body.add(p3);
  };
  frame(belt, wsTop, wsRange);
  const ws = shellPatch(rings, belt, wsTop, wsRange, 0.006, glass, 48, 6);
  ws.userData.glass = true;
  body.add(ws);
  if (classic) body.add(shellPatch(rings, belt, wsTop, () => [-0.004, 0.004], 0.008, dark, 1, 6));
  for (const side of [-1, 1]) {
    frame(winLow + 0.01, winTop - 0.01, (r) => winRange(r, side), 0.005, 0.04);
    const sw = shellPatch(rings, winLow, winTop, (r) => winRange(r, side), 0.006, glass, 16, 4);
    sw.userData.glass = true;
    body.add(sw);
  }
  // Everything inside the cab.
  body.add(cabInterior({ cabL, W, roofY, wsTop, belt, day, rings, doorBack, plate }));
  // Parked wipers along its lower edge.
  for (const z of [-0.55, 0.3]) {
    const wiper = box(0.03, 0.025, 0.85, M.plastic(), 0.008);
    wiper.rotation.y = 0.12;
    body.add(at(wiper, 0.03, belt + 0.05, z));
  }

  // Doors: seams, handles, lockers.
  for (const side of [-1, 1]) {
    const ring0 = ringAt(rings, y0 + 0.1);
    const seamV = (x: number, ya: number, yb: number) => {
      const s = sideS(ring0, x, side);
      body.add(shellPatch(rings, ya, yb, () => [s - 0.0012, s + 0.0012], 0.004, seam, 1, 6));
    };
    seamV(doorFront, y0 + 0.05, wsTop - 0.04);
    seamV(doorBack, y0 + 0.05, wsTop - 0.04);
    // The bottom of the door.
    const sA = sideS(ring0, doorFront, side);
    const sB = sideS(ring0, doorBack, side);
    body.add(shellPatch(rings, y0 + 0.05, y0 + 0.065, () => (side > 0 ? [sA, sB] : [sB, sA]), 0.004, seam, 8, 1));
    // A locker hatch behind the door on a sleeper cab.
    if (!day) {
      const lA = sideS(ring0, doorBack - 0.08, side);
      const lB = sideS(ring0, -cabL + 0.12, side);
      for (const yy of [y0 + 0.12, y0 + 0.7]) body.add(shellPatch(rings, yy, yy + 0.012, () => (side > 0 ? [lA, lB] : [lB, lA]), 0.004, seam, 6, 1));
      seamV(-cabL + 0.12, y0 + 0.12, y0 + 0.71);
      seamV(doorBack - 0.08, y0 + 0.12, y0 + 0.71);
    }
    const z = side * (hw + 0.012);
    const handle = box(0.2, 0.05, 0.03, M.chrome(), 0.012);
    body.add(at(handle, doorBack + 0.18, 1.86, z));
    body.add(at(box(0.22, 0.07, 0.01, new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.7 }), 0.01), doorBack + 0.18, 1.86, z - side * 0.008));
    // Grab handles beside the door, as on every cab-over.
    body.add(at(cyl(0.017, 0.017, 0.75, M.chrome(), 10), doorFront + 0.06, 1.55, side * (hw + 0.05)));
    body.add(at(cyl(0.017, 0.017, 0.75, M.chrome(), 10), doorBack - 0.05, 1.55, side * (hw + 0.05)));
    // Side repeater and marker.
    body.add(at(box(0.09, 0.035, 0.015, emissive('#f59e0b', night ? 1.5 : 0.35), 0.008), doorFront + 0.25, y0 + 0.22, z));
    // Mirrors: an arm from the A-pillar, the main mirror and the wide-angle one under it.
    const armM = new THREE.MeshStandardMaterial({ color: '#14171c', roughness: 0.5, metalness: 0.4 });
    const ax = -0.42 - rake * 0.5;
    body.add(tube([new THREE.Vector3(ax, wsTop - 0.05, side * (hw - 0.02)), new THREE.Vector3(ax + 0.12, wsTop + 0.02, side * (hw + 0.22)), new THREE.Vector3(-0.05, wsTop - 0.04, side * (hw + 0.4))], 0.022, armM, 16));
    const mx = -0.05;
    const mz = side * (hw + 0.42);
    const capM = new THREE.MeshStandardMaterial({ color: '#16191e', roughness: 0.45, metalness: 0.3 });
    const main = box(0.1, 0.5, 0.25, capM, 0.03);
    body.add(at(main, mx, wsTop - 0.42, mz));
    body.add(at(box(0.04, 0.46, 0.22, paint, 0.02), mx + 0.05, wsTop - 0.42, mz));
    const mg = decalPlane(0.22, 0.45, new THREE.MeshStandardMaterial({ color: '#a9bccf', metalness: 1, roughness: 0.04 }));
    mg.rotation.y = -Math.PI / 2;
    body.add(at(mg, mx - 0.053, wsTop - 0.42, mz));
    const wide = box(0.1, 0.23, 0.24, capM, 0.03);
    body.add(at(wide, mx, wsTop - 0.86, mz));
    body.add(at(box(0.04, 0.2, 0.21, paint, 0.02), mx + 0.05, wsTop - 0.86, mz));
    const wg = decalPlane(0.21, 0.19, new THREE.MeshStandardMaterial({ color: '#a9bccf', metalness: 1, roughness: 0.04 }));
    wg.rotation.y = -Math.PI / 2;
    body.add(at(wg, mx - 0.053, wsTop - 0.86, mz));
    body.add(at(cyl(0.015, 0.015, 0.2, armM, 8), mx, wsTop - 0.66, mz));
    // Company name on the door (the shop's sticker).
    if (cosmetics.sticker) {
      const st = shellPatch(rings, 1.35, 1.6, () => (side > 0 ? [sideS(ring0, doorFront - 0.1, side), sideS(ring0, doorBack + 0.1, side)] : [sideS(ring0, doorBack + 0.1, side), sideS(ring0, doorFront - 0.1, side)]), 0.006, new THREE.MeshStandardMaterial({ map: textTexture(cosmetics.sticker, '#f8fafc'), transparent: true, roughness: 0.4 }), 8, 1);
      if (side < 0) st.geometry.attributes.uv!.array.forEach((_, i, arr) => { if (i % 2 === 0) (arr as Float32Array)[i] = 1 - (arr as Float32Array)[i]!; });
      body.add(st);
    }
  }
  // Kerb mirror over the passenger side of the windscreen.
  body.add(at(box(0.18, 0.12, 0.24, paint, 0.04), -0.05 - rake, wsTop + 0.02, hw - 0.35));

  // Sun visor with marker lights; a tractor's roof fairing.
  const visorM = cosmetics.visor === 'chrome' ? M.chrome() : cosmetics.visor === 'black' ? new THREE.MeshStandardMaterial({ color: '#0b0e12', roughness: 0.35 }) : paint;
  const vr = ringAt(rings, wsTop);
  const visor = box(0.3, 0.06, W - 0.36, visorM, 0.03);
  visor.rotation.z = -0.22;
  body.add(at(visor, vr.xf + 0.08, wsTop + 0.05, 0));
  for (const z of [-0.75, -0.25, 0.25, 0.75]) body.add(at(box(0.04, 0.03, 0.1, emissive('#f59e0b', night ? 1.8 : 0.3), 0.01), vr.xf + 0.21, wsTop + 0.02, z));
  if (cosmetics.lights) {
    const c = LIGHT_COLORS[cosmetics.lights];
    body.add(at(box(0.08, 0.05, W - 0.6, M.chrome(), 0.02), vr.xf - 0.15, roofY + 0.06, 0));
    for (let i = -3; i <= 3; i++) body.add(at(box(0.12, 0.13, 0.15, emissive(c, night ? 2.8 : 0.9), 0.03), vr.xf - 0.12, roofY + 0.15, i * 0.3));
  }

  // ---- the face: grille, badge, bumper, headlights
  const gTop = 1.98;
  const gBot = 1.2;
  const gW = 1.72;
  const grilleBack = new THREE.Shape();
  grilleBack.moveTo(-gW / 2, gTop);
  grilleBack.lineTo(gW / 2, gTop);
  grilleBack.lineTo(gW / 2 - 0.1, gBot);
  grilleBack.lineTo(-gW / 2 + 0.1, gBot);
  grilleBack.lineTo(-gW / 2, gTop);
  const gb = new THREE.Mesh(new THREE.ShapeGeometry(grilleBack), new THREE.MeshStandardMaterial({ color: '#050608', roughness: 0.9 }));
  gb.rotation.y = Math.PI / 2;
  body.add(at(gb, 0.006, 0, 0));
  const trimM = cosmetics.grille === 'gold' ? new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.15, metalness: 1 }) : cosmetics.grille === 'black' ? new THREE.MeshStandardMaterial({ color: '#0e1013', roughness: 0.3, metalness: 0.5 }) : M.chrome();
  const barM = style.grille === 'closed' ? paint : cosmetics.grille ? trimM : new THREE.MeshStandardMaterial({ color: '#15181d', roughness: 0.35, metalness: 0.5 });
  if (style.grille === 'closed') {
    const panel = new THREE.Mesh(new THREE.ShapeGeometry(grilleBack), paint);
    panel.rotation.y = Math.PI / 2;
    body.add(at(panel, 0.012, 0, 0));
    body.add(at(box(0.02, 0.03, gW - 0.2, emissive('#7dd3fc', night ? 2.6 : 1.1), 0.01), 0.02, gTop - 0.2, 0));
  } else {
    const bars = style.grille === 'mesh' ? 8 : 5;
    for (let i = 0; i < bars; i++) {
      const y = gBot + 0.08 + ((gTop - gBot - 0.22) * i) / (bars - 1);
      const width = gW - 0.2 + ((y - gBot) / (gTop - gBot)) * 0.2 - 0.1;
      const bar = box(0.05, style.grille === 'mesh' ? 0.03 : 0.07, width, barM, 0.015);
      bar.rotation.z = -0.25;
      body.add(at(bar, 0.03, y, 0));
    }
    if (style.grille === 'slats-v') for (let i = 0; i < 11; i++) body.add(at(box(0.03, gTop - gBot - 0.2, 0.025, barM, 0.006), 0.025, (gTop + gBot) / 2 - 0.05, -0.7 + i * 0.14));
  }
  // Upper brand bar with the badge (chrome trim).
  body.add(at(box(0.05, 0.12, gW + 0.04, new THREE.MeshPhysicalMaterial({ color: '#0b0d10', roughness: 0.15, metalness: 0.3, clearcoat: 1 }), 0.03), 0.035, gTop - 0.04, 0));
  // A thin chrome frame round the grille.
  for (const [y0f, y1f, z0, z1] of [[gTop + 0.02, gTop + 0.02, -gW / 2, gW / 2], [gBot, gBot, -gW / 2 + 0.1, gW / 2 - 0.1]] as const) body.add(at(box(0.03, 0.02, z1 - z0, trimM, 0.008), 0.04, (y0f + y1f) / 2, 0));
  for (const side of [-1, 1]) {
    const edge = box(0.03, gTop - gBot, 0.02, trimM, 0.008);
    edge.rotation.x = side * 0.13;
    body.add(at(edge, 0.04, (gTop + gBot) / 2, side * (gW / 2 - 0.05)));
  }
  const badge = decalPlane(0.62, 0.11, new THREE.MeshStandardMaterial({ map: badgeTexture(unit.brand), transparent: true, metalness: 0.9, roughness: 0.2 }));
  badge.rotation.y = Math.PI / 2;
  body.add(at(badge, 0.063, gTop - 0.04, 0));
  body.add(at(box(0.03, 0.025, gW * 0.6, new THREE.MeshStandardMaterial({ color: style.accent, metalness: 0.6, roughness: 0.3 }), 0.01), 0.012, belt - 0.035, 0));

  // Bumper: wraps round the corners to the wheel arches; upper part painted, lower dark.
  const bumperPlan = (front: number, back: number, half: number, r: number) => {
    const s = new THREE.Shape();
    s.moveTo(back, -half);
    s.lineTo(front - r, -half);
    s.quadraticCurveTo(front, -half, front, -half + r);
    s.lineTo(front, half - r);
    s.quadraticCurveTo(front, half, front - r, half);
    s.lineTo(back, half);
    s.lineTo(back, -half);
    return s;
  };
  const vertical = (shape: THREE.Shape, h: number, m: THREE.Material, y: number) => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3, curveSegments: 12 });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.y = y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const upperBumper = vertical(bumperPlan(0.09, -0.62, hw - 0.01, classic ? 0.12 : 0.3), 0.36, classic ? M.chrome() : paint, 0.78);
  body.add(upperBumper);
  const lowerBumper = vertical(bumperPlan(0.05, -0.55, hw - 0.04, 0.32), 0.34, new THREE.MeshStandardMaterial({ color: '#22262c', roughness: 0.7, metalness: 0.1 }), 0.42);
  body.add(lowerBumper);
  // Air intake behind the plate, plate, fog lights, tow pin.
  body.add(at(box(0.02, 0.18, 1.3, new THREE.MeshStandardMaterial({ color: '#07080a', roughness: 0.9 }), 0.02), 0.085, 0.56, 0));
  const pl = decalPlane(0.52, 0.11, new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.4 }));
  pl.rotation.y = Math.PI / 2;
  body.add(at(pl, 0.1, 0.64, 0));
  for (const side of [-1, 1]) {
    const fog = cyl(0.055, 0.055, 0.03, emissive('#fffbeb', night ? 1.6 : 0.2), 20);
    fog.rotation.z = Math.PI / 2;
    body.add(at(fog, 0.075, 0.56, side * 0.92));
    body.add(at(box(0.02, 0.13, 0.17, new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.4 }), 0.03), 0.06, 0.56, side * 0.92));
  }
  // Headlights set into the bumper corners: a dark housing with a chrome reflector, projector
  // lenses, an L-shaped LED daytime running light, the indicator and a clear cover.
  const lightH = style.lights === 'slim' ? 0.15 : 0.23;
  const lightY = 1.0;
  for (const side of [-1, 1]) {
    const hz = side * (hw - 0.42);
    body.add(at(box(0.07, lightH + 0.03, 0.66, new THREE.MeshStandardMaterial({ color: '#0a0b0e', roughness: 0.35, metalness: 0.4 }), 0.04), 0.085, lightY, hz));
    const refl = decalPlane(0.6, lightH - 0.02, new THREE.MeshStandardMaterial({ color: '#4b5563', metalness: 1, roughness: 0.25 }));
    refl.rotation.y = Math.PI / 2;
    body.add(at(refl, 0.118, lightY, hz));
    const projectors = style.lights === 'quad' ? 2 : style.lights === 'round' ? 2 : 2;
    for (let k = 0; k < projectors; k++) {
      const pz = hz + side * (-0.06 - k * 0.17) * (style.lights === 'slim' ? 0.9 : 1);
      const r = style.lights === 'slim' ? 0.045 : 0.065;
      const ring = cyl(r + 0.012, r + 0.012, 0.03, M.chrome(), 28);
      ring.rotation.z = Math.PI / 2;
      body.add(at(ring, 0.122, lightY - 0.01, pz));
      const lens = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: '#e8eef5', emissive: new THREE.Color('#fff6e0'), emissiveIntensity: night ? 2.2 : 0.25, roughness: 0.05, metalness: 0.2, clearcoat: 1 }));
      lens.rotation.z = -Math.PI / 2;
      lens.scale.set(1, 0.45, 1);
      body.add(at(lens, 0.135, lightY - 0.01, pz));
    }
    // L-shaped LED: along the top and down the outer edge.
    const drl = emissive('#f4f8ff', night ? 3 : 1.8);
    body.add(at(box(0.012, 0.018, 0.5, drl, 0.006), 0.127, lightY + lightH / 2 - 0.03, hz - side * 0.03));
    body.add(at(box(0.012, lightH - 0.06, 0.018, drl, 0.006), 0.127, lightY, hz + side * 0.27));
    body.add(at(box(0.012, lightH - 0.08, 0.07, emissive('#f59e0b', 0.35), 0.008), 0.126, lightY, hz + side * 0.32));
    body.add(at(box(0.016, lightH, 0.64, M.lens(), 0.03), 0.142, lightY, hz));
    // Wrap-round corner piece with the side marker.
    const corner = box(0.05, lightH, 0.22, new THREE.MeshStandardMaterial({ color: '#0a0b0e', roughness: 0.3, metalness: 0.4 }), 0.03);
    corner.rotation.y = side * 0.8;
    body.add(at(corner, -0.02, lightY, side * (hw - 0.06)));
    body.add(at(box(0.04, 0.05, 0.1, emissive('#f59e0b', night ? 1.6 : 0.4), 0.01), -0.05, lightY, side * (hw + 0.005)));
  }

  // ---- under the cab: wheel arches and the steps behind the front wheels
  const frontAxle = day ? -1.25 : -1.38;
  for (const side of [-1, 1]) {
    body.add(mudguard(frontAxle, R, 0.36, side * (2.05 / 2), 'top'));
    // Step box: dark panel with two recessed treads.
    const sx0 = frontAxle - R - 0.1;
    const sx1 = -cabL + 0.02;
    const sw2 = Math.max(0.3, sx0 - sx1);
    const sxc = sx0 - sw2 / 2;
    body.add(at(box(sw2, 0.78, 0.18, new THREE.MeshStandardMaterial({ color: '#1d2127', roughness: 0.7 }), 0.03), sxc, 0.74, side * (hw - 0.1)));
    for (const yy of [0.5, 0.86]) {
      body.add(at(box(sw2 - 0.08, 0.14, 0.05, new THREE.MeshStandardMaterial({ color: '#06070a', roughness: 0.9 }), 0.01), sxc, yy, side * (hw - 0.005)));
      body.add(at(box(sw2 - 0.08, 0.025, 0.2, M.alu(), 0.005), sxc, yy - 0.06, side * (hw - 0.1)));
    }
  }

  // ---- the chassis
  const rearAxles = Math.max(1, unit.axles - 1);
  const wheelbase = tractor ? (rearAxles > 1 ? 3.3 : 3.7) : lightTruck ? 4.25 : sc < 1 ? 4.75 : 5.0;
  const firstRear = frontAxle - wheelbase;
  const lastRear = firstRear - (rearAxles - 1) * 1.36;
  const frameEnd = lastRear - (tractor ? 0.95 : lightTruck ? 1.9 : 2.0);
  const railY = 0.88;
  for (const side of [-1, 1]) body.add(at(box(-frameEnd - 0.4, 0.27, 0.09, M.frame(), 0.01), (frameEnd - 0.4) / 2, railY, side * 0.43));
  for (let x = -0.6; x > frameEnd + 0.2; x -= 1.1) body.add(at(box(0.09, 0.2, 0.8, M.frame(), 0.01), x, railY, 0));
  const tankX = -cabL - 0.85;
  if (electric) {
    // Battery packs on both sides between the axles, high-voltage cables, the charging socket.
    const packM = new THREE.MeshStandardMaterial({ color: '#2b3440', roughness: 0.45, metalness: 0.5 });
    const packL = Math.min(2.2, Math.abs(firstRear + R + 0.25 + cabL + 0.15));
    const px = -cabL - 0.15 - packL / 2;
    for (const side of [-1, 1]) {
      body.add(at(box(packL, 0.62, 0.5, packM, 0.06), px, 0.74, side * (hw - 0.33)));
      for (let k = 0; k < Math.floor(packL / 0.12); k++) body.add(at(box(0.02, 0.5, 0.02, new THREE.MeshStandardMaterial({ color: '#1b222b', roughness: 0.6 }), 0.004), px - packL / 2 + 0.08 + k * 0.12, 0.74, side * (hw - 0.07)));
      body.add(at(box(packL - 0.1, 0.04, 0.02, new THREE.MeshStandardMaterial({ color: '#0ea5e9', roughness: 0.4 }), 0.01), px, 0.98, side * (hw - 0.075)));
      body.add(tube([new THREE.Vector3(px + packL / 2 - 0.05, 0.95, side * (hw - 0.45)), new THREE.Vector3(px + packL / 2 + 0.2, 1.0, side * 0.3), new THREE.Vector3(-cabL + 0.2, 0.95, side * 0.25)], 0.025, new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.5 }), 20));
    }
    const port = box(0.22, 0.2, 0.04, new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.4 }), 0.03);
    body.add(at(port, -cabL - 0.3, 1.22, -hw + 0.04));
    body.add(at(box(0.12, 0.03, 0.01, emissive('#22c55e', night ? 2 : 0.8), 0.005), -cabL - 0.3, 1.3, -hw + 0.015));
  } else {
  // Right side: aluminium fuel tank on straps, then AdBlue. Left: silencer box, batteries, air tanks.
  const tank = box(1.4, 0.62, 0.62, M.alu(), 0.2);
  body.add(at(tank, tankX, 0.72, hw - 0.36));
  for (const dx of [-0.48, 0.48]) body.add(at(box(0.05, 0.66, 0.66, M.frame(), 0.01), tankX + dx, 0.72, hw - 0.36));
  body.add(at(cyl(0.065, 0.065, 0.05, M.chrome(), 16), tankX + 0.4, 1.05, hw - 0.36));
  body.add(at(box(0.42, 0.42, 0.42, M.plastic(), 0.1), tankX - 0.98, 0.72, hw - 0.3));
  body.add(at(cyl(0.05, 0.05, 0.04, emissive('#2563eb', 0.6), 12), tankX - 0.98, 0.95, hw - 0.3));
  const silencer = box(0.75, 0.55, 0.6, M.steel(), 0.08);
  body.add(at(silencer, -cabL - 0.5, 0.72, -hw + 0.36));
  const pipeDown = cyl(0.06, 0.06, 0.3, M.steel(), 12);
  body.add(at(pipeDown, -cabL - 0.88, 0.42, -hw + 0.3));
  body.add(at(box(0.6, 0.5, 0.48, M.plastic(), 0.04), -cabL - 1.35, 0.74, -hw + 0.32));
  for (let i = 0; i < 2; i++) {
    const air = cyl(0.12, 0.12, 0.75, M.steel(), 16);
    air.rotation.z = Math.PI / 2;
    body.add(at(air, -cabL - 1.35, 0.4 - i * 0, -0.2 + i * 0.4));
  }
  }
  // Rear wheels: mudguards over each axle, flaps behind the last, rear lights on brackets.
  for (const side of [-1, 1]) {
    for (let i = 0; i < rearAxles; i++) body.add(mudguard(firstRear - i * 1.36, R, 0.72, side * (2.05 / 2 - 0.18), i === rearAxles - 1 ? 'rear' : 'top'));
    body.add(mudflap(lastRear - R - 0.22, side * (2.05 / 2 - 0.18)));
  }
  rearLights(body, frameEnd + 0.04, 0.82, hw - 0.05, night);
  body.add(at(box(0.08, 0.06, W - 0.2, M.frame(), 0.01), frameEnd + 0.08, 0.82, 0));
  if (tractor) {
    // Deck plate behind the cab, a gantry with the coiled air and electric lines, the fifth wheel.
    body.add(at(box(0.7, 0.03, 1.2, new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.45, metalness: 0.8, normalMap: corrugatedNormal(60) }), 0.005), -cabL - 0.45, railY + 0.15, 0));
    for (const side of [-1, 1]) body.add(at(box(0.06, 0.9, 0.06, M.frame(), 0.01), -cabL - 0.15, railY + 0.6, side * 0.55));
    body.add(at(box(0.06, 0.06, 1.16, M.frame(), 0.01), -cabL - 0.15, railY + 1.05, 0));
    const fifthX = firstRear + (rearAxles > 1 ? -0.68 : 0.35);
    ['#dc2626', '#facc15', '#1d4ed8'].forEach((c, i) => {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 60; k++) {
        const a = k * 0.55;
        const t = k / 60;
        pts.push(new THREE.Vector3(-cabL - 0.15 - t * (Math.abs(fifthX + cabL) - 0.3), railY + 1.0 - t * 0.55 + Math.sin(a) * 0.09, -0.3 + i * 0.3 + Math.cos(a) * 0.09));
      }
      body.add(tube(pts, 0.012, new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }), 200));
    });
    const fifth = new THREE.Group();
    fifth.add(box(1.2, 0.12, 1.1, new THREE.MeshStandardMaterial({ color: '#202329', roughness: 0.5, metalness: 0.6 }), 0.03));
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 40), new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.2, metalness: 0.7 }));
    disc.position.y = 0.09;
    fifth.add(disc);
    const slot = box(0.5, 0.065, 0.12, new THREE.MeshStandardMaterial({ color: '#000', roughness: 1 }), 0.01);
    slot.position.set(-0.25, 0.095, 0);
    fifth.add(slot);
    body.add(at(fifth, fifthX, railY + 0.22, 0));
    // Cab side extenders (air deflectors behind the cab).
    if (!day) for (const side of [-1, 1]) body.add(at(box(0.36, roofY - 1.5, 0.03, paint, 0.015), -cabL - 0.17, (roofY + 1.5) / 2, side * (hw - 0.02)));
    // Air intake snorkel on the back of the cab.
    if (!electric) body.add(at(box(0.2, roofY - 1.5, 0.32, paint, 0.06), -cabL - 0.1, (roofY + 1.5) / 2 - 0.1, -hw + 0.3));
    if (!electric) body.add(at(box(0.04, 0.3, 0.26, new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.8, normalMap: corrugatedNormal(20) }), 0.01), -cabL - 0.21, roofY - 0.45, -hw + 0.3));
  }
  // Roof fairing: on a tractor by default, taller or lower with the tuning spoiler.
  const fairH = tuning.spoiler === 'high' ? 0.78 : tuning.spoiler === 'low' ? 0.48 : tractor && unit.cab !== 'highline' && !classic ? 0.32 : 0;
  if (fairH > 0) {
    const d = new THREE.Shape();
    const len = cabL - 0.8;
    d.moveTo(0, 0);
    d.lineTo(len, 0);
    d.bezierCurveTo(len * 0.7, 0.02, len * 0.35, fairH * 0.85, 0.05, fairH);
    d.lineTo(0, fairH);
    d.lineTo(0, 0);
    const fair = new THREE.Mesh(new THREE.ExtrudeGeometry(d, { depth: W - 0.6, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.03, bevelSegments: 6, curveSegments: 20 }), paint);
    fair.geometry.translate(0, 0, -(W - 0.6) / 2);
    fair.castShadow = true;
    const objs = [at(fair, -cabL + 0.1, roofY - 0.03, 0)];
    if (tuning.spoiler) addPart('spoiler', objs);
    else body.add(fair);
  }

  // ---- a rigid's body
  if (!tractor && (unit.body === 'tipper' || unit.body === 'tanker')) {
    const x0 = -cabL - 0.25;
    const bodyL = x0 - frameEnd;
    const xc = x0 - bodyL / 2;
    // Subframe on the chassis.
    for (const side of [-1, 1]) body.add(at(box(bodyL, 0.16, 0.12, M.frame(), 0.01), xc, 1.1, side * 0.45));
    if (unit.body === 'tipper') {
      // Steel tub: tapered sides with vertical ribs, a cab guard over the cab, the tailgate.
      const tubH = 1.25;
      const tubY = 1.2;
      const tubM = paintMat('#9ca3af', 100);
      const sideShape = new THREE.Shape();
      sideShape.moveTo(0, 0);
      sideShape.lineTo(bodyL, 0);
      sideShape.lineTo(bodyL + 0.08, tubH);
      sideShape.lineTo(-0.05, tubH);
      sideShape.lineTo(0, 0);
      body.add(at(box(bodyL, 0.1, W - 0.05, tubM, 0.02), xc, tubY + 0.05, 0));
      for (const side of [-1, 1]) {
        const wall = box(bodyL, tubH, 0.06, tubM, 0.02);
        wall.rotation.x = side * 0.06;
        body.add(at(wall, xc, tubY + tubH / 2, side * (W / 2 - 0.02)));
        for (let k = 0; k <= Math.floor(bodyL / 0.6); k++) body.add(at(box(0.07, tubH - 0.05, 0.05, tubM, 0.01), frameEnd + 0.1 + k * 0.6, tubY + tubH / 2, side * (W / 2 + 0.03)));
        body.add(at(box(bodyL + 0.05, 0.08, 0.08, tubM, 0.02), xc, tubY + tubH, side * (W / 2 + 0.02)));
      }
      body.add(at(box(0.08, tubH + 0.35, W, tubM, 0.02), x0 - 0.02, tubY + (tubH + 0.35) / 2, 0));
      body.add(at(box(0.6, 0.06, W - 0.1, tubM, 0.02), x0 + 0.25, tubY + tubH + 0.35, 0));
      body.add(at(box(0.08, tubH, W, tubM, 0.02), frameEnd + 0.04, tubY + tubH / 2, 0));
      for (const side of [-1, 1]) body.add(at(cyl(0.05, 0.05, 0.12, M.steel(), 12).rotateX(Math.PI / 2), frameEnd + 0.02, tubY + tubH - 0.05, side * (W / 2 - 0.1)));
      // Front-mounted hydraulic ram behind the cab.
      body.add(at(cyl(0.1, 0.1, 1.1, M.chrome(), 18), x0 + 0.1, 1.55, 0));
      body.add(at(cyl(0.13, 0.13, 0.5, M.frame(), 18), x0 + 0.1, 1.2, 0));
      // Ladder on the front corner.
      for (let k = 0; k < 5; k++) body.add(at(box(0.04, 0.03, 0.3, M.steel(), 0.005), x0 - 0.12, 1.3 + k * 0.25, W / 2 - 0.2));
    } else {
      // Elliptical tank in three compartments: domes and manholes on top, a walkway with a railing,
      // the valve cabinet at the back, hose tubes along the sides.
      const tankM = new THREE.MeshStandardMaterial({ color: '#dfe4ea', roughness: 0.16, metalness: 0.95 });
      const tank = new THREE.Mesh(new THREE.CapsuleGeometry(1.0, bodyL - 2.0, 12, 48), tankM);
      tank.rotation.z = Math.PI / 2;
      tank.scale.set(1, 1, 1.18);
      tank.castShadow = true;
      body.add(at(tank, xc, 2.25, 0));
      for (let k = 1; k < 3; k++) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.03, 8, 48), M.steel());
        band.rotation.y = Math.PI / 2;
        band.scale.set(1.18, 1, 1);
        body.add(at(band, x0 - (bodyL * k) / 3, 2.25, 0));
      }
      for (let k = 0; k < 3; k++) {
        const mx = x0 - (bodyL * (k + 0.5)) / 3;
        body.add(at(cyl(0.28, 0.3, 0.12, M.alu(), 24), mx, 3.28, 0));
        body.add(at(cyl(0.2, 0.2, 0.05, M.steel(), 20), mx, 3.36, 0));
      }
      body.add(at(box(bodyL - 1.2, 0.03, 0.55, new THREE.MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.8, roughness: 0.4, normalMap: corrugatedNormal(60) }), 0.005), xc, 3.27, 0));
      for (const side of [-1, 1]) {
        body.add(at(box(bodyL - 1.2, 0.03, 0.03, M.alu(), 0.01), xc, 3.62, side * 0.4));
        for (let k = 0; k < 5; k++) body.add(at(box(0.03, 0.35, 0.03, M.alu(), 0.005), x0 - 0.6 - k * ((bodyL - 1.2) / 4), 3.45, side * 0.4));
        body.add(at(cyl(0.08, 0.08, bodyL - 1.5, M.alu(), 16).rotateZ(Math.PI / 2), xc, 1.25, side * (W / 2 - 0.08)));
      }
      body.add(at(box(0.5, 0.75, W - 0.1, M.alu(), 0.03), frameEnd + 0.25, 1.15, 0));
      for (let k = 0; k < 3; k++) body.add(at(cyl(0.05, 0.05, 0.12, new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.4 }), 12).rotateZ(Math.PI / 2), frameEnd - 0.02, 1.15, -0.6 + k * 0.6));
      for (let k = 0; k < 6; k++) body.add(at(box(0.03, 0.03, 0.4, M.steel(), 0.005), frameEnd + 0.02, 1.6 + k * 0.28, W / 2 - 0.3));
    }
    for (const side of [-1, 1]) {
      const gx0 = -cabL - 0.3;
      const gx1 = firstRear + R + 0.25;
      if (gx0 - gx1 > 0.4) for (const yy of [0.5, 0.8]) body.add(at(box(gx0 - gx1, 0.08, 0.04, M.alu(), 0.01), (gx0 + gx1) / 2, yy, side * (hw - 0.08)));
    }
    const rpl = decalPlane(0.52, 0.11, new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.4 }));
    rpl.rotation.y = -Math.PI / 2;
    body.add(at(rpl, frameEnd + 0.02, 0.62, 0));
  }
  if (!tractor && unit.body !== 'tipper' && unit.body !== 'tanker') {
    const x0 = -cabL - 0.18;
    const bodyL = x0 - frameEnd;
    const by = 1.1;
    const bodyH = lightTruck ? 2.75 : 2.7;
    const xc = x0 - bodyL / 2;
    body.add(at(box(bodyL, bodyH, W + 0.03, M.white(), 0.03), xc, by + bodyH / 2, 0));
    for (const x of [x0, frameEnd]) for (const side of [-1, 1]) body.add(at(box(0.08, bodyH + 0.03, 0.08, M.alu(), 0.01), x, by + bodyH / 2, side * (hw + 0.01)));
    body.add(at(box(bodyL, 0.08, W + 0.08, M.alu(), 0.01), xc, by + bodyH, 0));
    body.add(at(box(bodyL, 0.14, W + 0.08, M.alu(), 0.01), xc, by, 0));
    if (unit.body === 'reefer') body.add(at(box(0.45, 0.85, 1.7, new THREE.MeshStandardMaterial({ color: '#cfd4da', roughness: 0.4, metalness: 0.3 }), 0.05), x0 + 0.23, by + bodyH - 0.55, 0));
    for (const side of [-1, 1]) {
      const strip = contourStrip(bodyL - 0.2, 'yellow');
      if (side < 0) strip.rotation.y = Math.PI;
      body.add(at(strip, xc, by + 0.12, side * (hw + 0.045)));
      const gx0 = -cabL - 0.3;
      const gx1 = firstRear + R + 0.25;
      if (gx0 - gx1 > 0.4) for (const yy of [0.5, 0.8]) body.add(at(box(gx0 - gx1, 0.08, 0.04, M.alu(), 0.01), (gx0 + gx1) / 2, yy, side * (hw - 0.08)));
      if (look.company) {
        const name = decalPlane(bodyL * 0.7, 0.5, new THREE.MeshStandardMaterial({ map: textTexture(look.company, '#0f172a'), transparent: true }));
        if (side < 0) name.rotation.y = Math.PI;
        body.add(at(name, xc, by + bodyH * 0.6, side * (hw + 0.03)));
      }
    }
    const shutter = decalPlane(W - 0.2, bodyH - 0.2, new THREE.MeshStandardMaterial({ color: '#e5e7eb', normalMap: corrugatedNormal(40), roughness: 0.4, metalness: 0.4 }));
    shutter.rotation.y = -Math.PI / 2;
    shutter.rotation.z = Math.PI / 2;
    body.add(at(shutter, frameEnd - 0.045, by + bodyH / 2, 0));
    const rpl = decalPlane(0.52, 0.11, new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.4 }));
    rpl.rotation.y = -Math.PI / 2;
    body.add(at(rpl, frameEnd + 0.02, 0.62, 0));
  }
  if (unit.look === 'plow') {
    // Snow plough: a curved mouldboard on a push frame, a rubber cutting edge, warning chevrons,
    // and amber beacons on the roof.
    const plough = new THREE.Group();
    // The mouldboard curves forward at the top (concave to the front); its centre of curvature
    // sits ahead of it. theta: pi = top, 1.5 pi = straight back, 2 pi = bottom.
    const pr = 0.62;
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, W * 1.32, 40, 1, true, Math.PI * 1.1, Math.PI * 0.85), new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.42, metalness: 0.25, side: THREE.DoubleSide }));
    blade.rotation.x = Math.PI / 2;
    blade.castShadow = true;
    plough.add(blade);
    // Rubber cutting edge along the bottom, the top lip with red-white warning stripes.
    plough.add(at(box(0.04, 0.12, W * 1.32, new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 }), 0.01), -0.1, -pr + 0.02, 0));
    for (let i = 0; i < 12; i++) plough.add(at(box(0.03, 0.06, (W * 1.3) / 12 - 0.01, new THREE.MeshStandardMaterial({ color: i % 2 ? '#f8fafc' : '#dc2626', roughness: 0.5 }), 0.005), -0.2, pr - 0.03, -W * 0.65 + (i + 0.5) * ((W * 1.3) / 12)));
    // Push frame behind the blade.
    for (const z of [-0.7, 0.7]) plough.add(at(box(0.5, 0.1, 0.12, M.steel(), 0.01), -pr - 0.2, -0.1, z));
    plough.rotation.y = 0.28;
    body.add(at(plough, 0.85 + pr, pr + 0.08, 0));
    for (const z of [-0.6, 0.6]) body.add(at(box(0.6, 0.1, 0.12, M.steel(), 0.01), 0.3, 0.62, z));
    for (const side of [-1, 1]) {
      const beacon = new THREE.Group();
      beacon.add(cyl(0.1, 0.11, 0.06, M.plastic(), 20));
      beacon.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), emissive('#f59e0b', night ? 3 : 1.2)), 0, 0.03, 0));
      body.add(at(beacon, -0.9, roofY + 0.05, side * 0.75));
    }
  }

  // ---- tuning
  if (tuning.skirts) {
    const m = tuning.skirts === 'body' ? paint : tuning.skirts === 'chrome' ? M.chrome() : new THREE.MeshStandardMaterial({ color: '#0b0e12', roughness: 0.45 });
    const x0 = -cabL - 0.05;
    const x1 = firstRear + R + 0.12;
    const objs: THREE.Object3D[] = [];
    for (const side of [-1, 1]) objs.push(at(box(x0 - x1, 0.6, 0.05, m, 0.025), (x0 + x1) / 2, 0.68, side * (hw - 0.02)));
    addPart('skirts', objs);
  }
  if (tuning.bullbar) {
    const m = tuning.bullbar === 'chrome' ? M.chrome() : new THREE.MeshStandardMaterial({ color: '#111318', roughness: 0.35, metalness: 0.6 });
    const objs: THREE.Object3D[] = [];
    for (const y of [0.55, 0.98]) objs.push(tube([new THREE.Vector3(-0.45, y, -hw + 0.02), new THREE.Vector3(0.05, y, -hw + 0.12), new THREE.Vector3(0.24, y, -0.6), new THREE.Vector3(0.26, y, 0), new THREE.Vector3(0.24, y, 0.6), new THREE.Vector3(0.05, y, hw - 0.12), new THREE.Vector3(-0.45, y, hw - 0.02)], 0.04, m, 60));
    for (const z of [-0.9, -0.35, 0.35, 0.9]) objs.push(at(cyl(0.035, 0.035, 0.45, m, 12), Math.abs(z) > 0.8 ? 0.17 : 0.25, 0.77, z));
    for (const z of [-0.55, 0.55]) {
      const spot = cyl(0.1, 0.1, 0.09, emissive('#fffbeb', night ? 2.2 : 0.35), 20);
      spot.rotation.z = Math.PI / 2;
      objs.push(at(spot, 0.3, 1.12, z));
    }
    addPart('bullbar', objs);
  }
  if (tuning.exhaust && !unit.electric) {
    const objs: THREE.Object3D[] = [];
    for (const side of tuning.exhaust === 'twin' ? [-1, 1] : [1]) {
      const top = roofY + 0.45;
      objs.push(at(cyl(0.085, 0.085, top - 0.9, M.chrome(), 20), -cabL - 0.3, (top + 0.9) / 2, side * (hw - 0.22)));
      const tip = cyl(0.095, 0.085, 0.22, M.chrome(), 20);
      tip.rotation.z = -0.4;
      objs.push(at(tip, -cabL - 0.26, top + 0.08, side * (hw - 0.22)));
      objs.push(at(box(0.05, 1.1, 0.2, new THREE.MeshStandardMaterial({ color: '#9ca3af', metalness: 0.9, roughness: 0.3, normalMap: corrugatedNormal(30) }), 0.01), -cabL - 0.2, top - 0.9, side * (hw - 0.22)));
    }
    addPart('exhaust', objs);
  }
  if (tuning.decal) {
    const objs: THREE.Object3D[] = [];
    const tex = decalTexture(tuning.decal);
    const ring0 = ringAt(rings, y0 + 0.1);
    for (const side of [-1, 1]) {
      const a = sideS(ring0, -0.25, side);
      const b = sideS(ring0, -cabL + 0.1, side);
      const d = shellPatch(rings, y0 + 0.05, belt - 0.05, () => (side > 0 ? [a, b] : [b, a]), 0.007, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.3 }), 16, 3);
      if (side < 0) d.geometry.attributes.uv!.array.forEach((_, i, arr) => { if (i % 2 === 0) (arr as Float32Array)[i] = 1 - (arr as Float32Array)[i]!; });
      objs.push(d);
    }
    addPart('decal', objs);
  }

  // ---- wear on the cab sides
  if (condition < 55) {
    const sm = new THREE.MeshStandardMaterial({ color: '#cfd5dc', roughness: 0.9 });
    for (let i = 0; i < (condition < 35 ? 9 : 5); i++) {
      const side = i % 2 ? 1 : -1;
      const sc = decalPlane(0.22 + (i % 3) * 0.12, 0.012, sm);
      sc.rotation.z = (i - 4) * 0.12;
      if (side < 0) sc.rotation.y = Math.PI;
      body.add(at(sc, -0.4 - ((i * 0.37) % (cabL - 0.6)), y0 + 0.15 + ((i * 0.29) % 0.7), side * (hw + 0.006)));
    }
  }
  if (condition < 35) for (let i = 0; i < 7; i++) {
    const side = i % 2 ? 1 : -1;
    const rust = new THREE.Mesh(new THREE.CircleGeometry(0.05 + (i % 3) * 0.035, 12), new THREE.MeshStandardMaterial({ color: '#7c3f17', roughness: 1 }));
    if (side < 0) rust.rotation.y = Math.PI;
    body.add(at(rust, -0.3 - i * 0.27, y0 + 0.08 + (i % 2) * 0.12, side * (hw + 0.008)));
  }

  // ---- wheels
  axle(root, frontAxle, 2.05, R, 'steer', rimColor, set);
  for (let i = 0; i < rearAxles; i++) axle(root, firstRear - i * 1.36, 2.05, R, 'drive', rimColor, set);

  // ---- trailer
  let total = 0;
  if (tractor && look.trailerModelId) {
    const fifthX = firstRear + (rearAxles > 1 ? -0.68 : 0.35);
    const tr = buildTrailer(look.trailerModelId, look.trailerColor ?? '#e9edf1', set, night, plate, look.company ?? null);
    tr.group.position.x = fifthX + tr.kingpinFromFront - tr.length / 2;
    root.add(tr.group);
  }
  root.scale.setScalar(sc);
  root.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(root);
  const cx = (bbox.min.x + bbox.max.x) / 2;
  root.children.forEach((c) => (c.position.x -= cx / sc));
  total = bbox.max.x - bbox.min.x;
  const eye = new THREE.Vector3(-1.38 * sc - cx, (2.6 + lift) * sc, -0.55 * sc);
  return { group: root, length: total, wheels: set.wheels, parts, eye, cab: { frontX: -cx, length: cabL * sc, height: (roofY + lift) * sc, width: W * sc, floorY: (1.45 + lift) * sc } };
}

// ---------------------------------------------------------------- the cab interior

/**
 * The inside of a modern European cab-over (left-hand drive), to scale: a flat floor at
 * 1.45 m, a wrap-around dashboard under the windscreen with the instrument binnacle and
 * a centre stack angled to the driver, a steering wheel tilted ~35° about 0.5 m in front
 * of the eyes, air-suspended seats with bolsters, door trims, sun visors, overhead
 * lockers (high roof) or a shelf, the bunk with a fridge drawer, curtains and lights.
 */
function cabInterior(p: { cabL: number; W: number; roofY: number; wsTop: number; belt: number; day: boolean; rings: Ring[]; doorBack: number; plate: string }) {
  const g = new THREE.Group();
  g.userData.interior = true;
  const { cabL, W, roofY, wsTop, belt } = p;
  const hw = W / 2;
  const floorY = 1.45;
  const dZ = -0.55; // driver's seat (left-hand drive)
  // Interior colours: anthracite plastics, a lighter grey headliner, dark fabric; the room's
  // reflections are kept low so the cabin does not look washed out.
  const env = 0.35;
  const soft = new THREE.MeshStandardMaterial({ color: '#1d2025', roughness: 0.9, envMapIntensity: env });
  const softLight = new THREE.MeshStandardMaterial({ color: '#3a4049', roughness: 0.9, envMapIntensity: env });
  const satin = new THREE.MeshStandardMaterial({ color: '#121418', roughness: 0.5, metalness: 0.15, envMapIntensity: env });
  const trimAlu = new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.3, metalness: 0.85, envMapIntensity: 0.6 });
  const fabric = new THREE.MeshStandardMaterial({ map: fabricTexture('#2a2f37'), roughness: 0.95, envMapIntensity: env });
  const leatherSeat = new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.6, envMapIntensity: env });
  const glow = (c: string, i = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i), toneMapped: false });

  // Floor with rubber mats.
  g.add(at(box(cabL - 0.2, 0.04, W - 0.2, new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 1 }), 0.01), -cabL / 2, floorY - 0.02, 0));
  for (const z of [dZ, -dZ]) {
    const mat2 = box(0.75, 0.012, 0.6, new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 1, normalMap: corrugatedNormal(50) }), 0.01);
    g.add(at(mat2, -0.95, floorY + 0.005, z));
  }

  // Dashboard: one moulding across the cab (side profile extruded across the width).
  const dash = new THREE.Shape();
  dash.moveTo(-0.07, belt - 0.04);
  dash.lineTo(-0.42, belt + 0.01);
  dash.quadraticCurveTo(-0.6, belt + 0.02, -0.63, belt - 0.08);
  dash.lineTo(-0.6, belt - 0.32);
  dash.quadraticCurveTo(-0.56, floorY + 0.12, -0.42, floorY);
  dash.lineTo(-0.07, floorY);
  dash.lineTo(-0.07, belt - 0.04);
  const dashMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(dash, { depth: W - 0.22, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4, curveSegments: 16 }), soft);
  dashMesh.geometry.translate(0, 0, -(W - 0.22) / 2);
  dashMesh.castShadow = true;
  dashMesh.receiveShadow = true;
  g.add(dashMesh);
  // Satin trim line along the dash and air vents.
  g.add(at(box(0.015, 0.02, W - 0.3, trimAlu, 0.006), -0.64, belt - 0.1, 0));
  for (const z of [-hw + 0.28, -0.22, 0.32, hw - 0.28]) {
    g.add(at(box(0.02, 0.07, 0.17, satin, 0.015), -0.635, belt - 0.17, z));
    for (let k = 0; k < 4; k++) g.add(at(box(0.012, 0.006, 0.15, trimAlu, 0.002), -0.646, belt - 0.2 + k * 0.02, z));
  }
  // Instrument binnacle: the cluster screen under a visor, tilted up toward the driver.
  const binn = new THREE.Group();
  binn.add(at(box(0.06, 0.26, 0.7, soft, 0.03), 0.03, 0, 0));
  const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.21), new THREE.MeshBasicMaterial({ map: clusterTexture(), toneMapped: false }));
  cluster.rotation.y = -Math.PI / 2;
  binn.add(at(cluster, -0.002, 0, 0));
  const visorB = box(0.07, 0.022, 0.72, soft, 0.01);
  binn.add(at(visorB, -0.03, 0.125, 0));
  for (const dz of [-0.355, 0.355]) binn.add(at(box(0.07, 0.25, 0.022, soft, 0.01), -0.03, 0.01, dz));
  binn.rotation.z = -0.55; // the screen faces up and back, toward the driver's eyes
  g.add(at(binn, -0.66, belt + 0.1, dZ));
  // Centre stack angled toward the driver: screen, climate controls, gear selector.
  const wing = new THREE.Group();
  wing.add(at(box(0.08, 0.42, 0.5, soft, 0.04), 0, 0, 0));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), new THREE.MeshBasicMaterial({ map: navTexture(), toneMapped: false }));
  screen.rotation.y = -Math.PI / 2;
  wing.add(at(screen, -0.042, 0.08, 0));
  wing.add(at(box(0.012, 0.21, 0.32, satin, 0.01), -0.038, 0.08, 0));
  for (let i = 0; i < 6; i++) wing.add(at(box(0.015, 0.03, 0.05, i % 2 ? satin : trimAlu, 0.008), -0.045, -0.08, -0.15 + i * 0.06));
  for (const dz of [-0.12, 0.12]) {
    const knob = cyl(0.028, 0.028, 0.03, trimAlu, 20);
    knob.rotation.z = Math.PI / 2;
    wing.add(at(knob, -0.05, -0.14, dz));
  }
  wing.rotation.y = -0.38;
  wing.rotation.z = 0.12;
  g.add(at(wing, -0.62, belt - 0.24, -0.05));
  const selector = new THREE.Group();
  selector.add(at(box(0.08, 0.06, 0.06, satin, 0.02), 0, 0, 0));
  selector.add(at(cyl(0.012, 0.012, 0.12, satin, 10), -0.02, 0.07, 0));
  selector.add(at(box(0.05, 0.035, 0.035, trimAlu, 0.012), -0.03, 0.13, 0));
  g.add(at(selector, -0.66, belt - 0.42, -0.2));

  // Steering wheel: leather rim, three spokes, the hub pad, on a column with two stalks.
  const wheelG = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.62 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.026, 16, 72), leather);
  rim.castShadow = true;
  wheelG.add(rim);
  for (const a of [-Math.PI / 2, Math.PI * 0.05, Math.PI * 0.95]) {
    const spoke = box(0.2, 0.05, 0.022, satin, 0.012);
    spoke.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.01);
    spoke.rotation.z = a;
    wheelG.add(spoke);
  }
  const pad = box(0.17, 0.12, 0.06, leather, 0.035);
  wheelG.add(at(pad, 0, -0.01, 0.025));
  for (const dx of [-0.13, 0.13]) for (let k = 0; k < 3; k++) wheelG.add(at(box(0.022, 0.014, 0.008, satin, 0.004), dx, 0.03 - k * 0.024, 0.026));
  const wheelOrient = new THREE.Group();
  wheelG.rotation.x = -Math.PI / 2; // face up
  wheelOrient.add(wheelG);
  wheelOrient.rotation.z = 0.62; // tilt toward the driver
  g.add(at(wheelOrient, -0.98, belt - 0.13, dZ));
  const column = cyl(0.04, 0.05, 0.42, soft, 16);
  column.rotation.z = Math.PI / 2 + 0.62;
  g.add(at(column, -0.82, belt - 0.22, dZ));
  for (const dz of [-0.09, 0.09]) {
    const stalk = cyl(0.008, 0.008, 0.17, satin, 8);
    stalk.rotation.x = Math.PI / 2;
    stalk.rotation.z = 0.25;
    g.add(at(stalk, -0.85, belt - 0.2, dZ + dz * 1.4));
  }
  // Pedals.
  for (const [dz, wdt] of [[-0.12, 0.08], [0.02, 0.08], [0.15, 0.06]] as const) {
    const pedal = box(0.03, 0.14, wdt, satin, 0.01);
    pedal.rotation.z = 0.5;
    g.add(at(pedal, -0.5, floorY + 0.12, dZ + dz));
  }

  // Seats on air suspension: base with bellows, cushion and backrest with bolsters, headrest, belt.
  const seat = (z: number, driver: boolean) => {
    const st = new THREE.Group();
    // Rails, the air bellows and the scissor frame.
    for (const side of [-1, 1]) st.add(at(box(0.45, 0.025, 0.03, trimAlu, 0.005), 0, 0.02, side * 0.17));
    st.add(at(cyl(0.1, 0.1, 0.16, new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.95, normalMap: corrugatedNormal(16), envMapIntensity: env }), 24), 0, 0.14, 0));
    st.add(at(box(0.44, 0.07, 0.44, satin, 0.02), 0, 0.26, 0));
    // Cushion: a fabric centre between leather bolsters, slightly raised at the front.
    const cushion = new THREE.Group();
    cushion.add(at(box(0.48, 0.1, 0.32, fabric, 0.045), 0, 0, 0));
    for (const side of [-1, 1]) {
      const bolster = box(0.48, 0.13, 0.07, leatherSeat, 0.035);
      bolster.rotation.x = side * 0.15;
      cushion.add(at(bolster, 0, 0.02, side * 0.2));
    }
    cushion.rotation.z = 0.06;
    st.add(at(cushion, 0.02, 0.35, 0));
    // Backrest with side bolsters, lumbar seam and the integrated headrest.
    const back = new THREE.Group();
    back.add(at(box(0.1, 0.68, 0.32, fabric, 0.045), 0, 0.34, 0));
    for (const side of [-1, 1]) {
      const bolster = box(0.14, 0.58, 0.07, leatherSeat, 0.035);
      bolster.rotation.y = -side * 0.25;
      back.add(at(bolster, 0.03, 0.3, side * 0.2));
    }
    back.add(at(box(0.11, 0.02, 0.3, leatherSeat, 0.008), 0.05, 0.2, 0));
    back.add(at(box(0.1, 0.22, 0.28, leatherSeat, 0.05), -0.01, 0.78, 0));
    back.add(at(box(0.04, 0.05, 0.02, trimAlu, 0.01), -0.01, 0.71, 0.08));
    back.rotation.z = -0.2;
    st.add(at(back, -0.23, 0.4, 0));
    if (driver) {
      st.add(at(box(0.3, 0.05, 0.06, leatherSeat, 0.025), -0.06, 0.6, 0.27));
      st.add(at(box(0.05, 0.12, 0.05, satin, 0.01), -0.17, 0.52, 0.27));
    }
    // Seat belt from the shoulder across the backrest.
    const beltS = box(0.008, 0.66, 0.048, new THREE.MeshStandardMaterial({ color: '#0c0d0f', roughness: 0.8 }), 0.004);
    beltS.rotation.x = (z < 0 ? 1 : -1) * 0.55;
    beltS.rotation.z = -0.2;
    st.add(at(beltS, -0.12, 0.75, 0));
    st.position.set(-1.5, floorY, z);
    return st;
  };
  g.add(seat(dZ, true), seat(-dZ, false));

  // Door trims: panel, armrest, pocket, speaker, handle and window switches.
  for (const side of [-1, 1]) {
    const z = side * (hw - 0.09);
    const door = new THREE.Group();
    door.add(at(box(1.0, belt - floorY - 0.04, 0.04, soft, 0.02), 0, 0, 0));
    door.add(at(box(0.6, 0.06, 0.1, softLight, 0.03), -0.12, 0.08, -side * 0.05));
    door.add(at(box(0.5, 0.14, 0.04, new THREE.MeshStandardMaterial({ color: '#0e0f12', roughness: 1 }), 0.02), -0.1, -0.2, -side * 0.035));
    const speaker = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), new THREE.MeshStandardMaterial({ color: '#0b0c0e', roughness: 0.9, normalMap: corrugatedNormal(80) }));
    speaker.rotation.y = side > 0 ? Math.PI : 0;
    door.add(at(speaker, 0.28, -0.18, -side * 0.022));
    door.add(at(box(0.14, 0.025, 0.02, trimAlu, 0.01), 0.18, 0.2, -side * 0.025));
    for (let k = 0; k < 2; k++) door.add(at(box(0.03, 0.012, 0.025, satin, 0.005), -0.2 + k * 0.05, 0.115, -side * 0.06));
    g.add(at(door, -1.05, floorY + (belt - floorY) / 2, z));
    // A-pillar grab handle inside.
    const grab = cyl(0.015, 0.015, 0.4, satin, 8);
    grab.rotation.z = 0.35;
    g.add(at(grab, -0.32, belt + 0.35, side * (hw - 0.14)));
  }

  // Sun visors, rear-view of the curtains bunched at the A-pillars, the roof console or lockers.
  for (const z of [dZ, -dZ]) {
    const visor = box(0.24, 0.02, 0.62, softLight, 0.01);
    visor.rotation.z = z === dZ ? 0.85 : 0.2;
    g.add(at(visor, -0.3, wsTop - 0.12, z));
  }
  // Curtains folded flat against the A-pillars.
  for (const side of [-1, 1]) {
    const curtain = box(0.07, wsTop - belt - 0.05, 0.05, new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 1, normalMap: curtainNormal(), envMapIntensity: env }), 0.02);
    curtain.rotation.y = side * 0.5;
    g.add(at(curtain, -0.2, (belt + wsTop) / 2, side * (hw - 0.13)));
  }
  const highRoof = roofY - wsTop > 0.5;
  if (highRoof) {
    // Lockers over the windscreen with lids, handles and a centre console (tachograph, radio).
    const lockY = wsTop + 0.08;
    const lockH = roofY - lockY - 0.18;
    g.add(at(box(0.5, lockH, W - 0.3, softLight, 0.04), -0.55, lockY + lockH / 2, 0));
    for (const z of [-0.78, 0.78]) {
      g.add(at(box(0.01, lockH - 0.06, 0.62, new THREE.MeshStandardMaterial({ color: '#555c66', roughness: 0.9 }), 0.01), -0.805, lockY + lockH / 2, z));
      g.add(at(box(0.02, 0.025, 0.16, trimAlu, 0.01), -0.815, lockY + 0.06, z));
    }
    const consoleG = new THREE.Group();
    consoleG.add(at(box(0.04, lockH - 0.04, 0.7, satin, 0.02), 0, 0, 0));
    consoleG.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.035), glow('#22c55e', 0.8)).rotateY(-Math.PI / 2), -0.022, 0.05, -0.15));
    consoleG.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.04), glow('#38bdf8', 0.8)).rotateY(-Math.PI / 2), -0.022, 0.05, 0.16));
    for (let i = 0; i < 5; i++) consoleG.add(at(box(0.012, 0.02, 0.03, trimAlu, 0.005), -0.025, -0.04, -0.2 + i * 0.1));
    g.add(at(consoleG, -0.81, lockY + lockH / 2, 0));
  } else {
    g.add(at(box(0.3, 0.12, W - 0.5, softLight, 0.03), -0.42, wsTop + 0.02, 0));
    g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.035), glow('#22c55e', 0.8)).rotateY(-Math.PI / 2), -0.575, wsTop + 0.02, 0.1));
  }
  // Roof lights.
  for (const x of [-0.95, -1.75]) g.add(at(new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.12), glow('#fff4dc', 0.5)).rotateX(Math.PI / 2), x, roofY - 0.13, 0));

  // Back of the cab: the bunk with a mattress, pillow and blanket, a fridge drawer, lockers.
  if (!p.day) {
    const bunkX = -cabL + 0.42;
    g.add(at(box(0.66, 0.42, W - 0.24, soft, 0.03), bunkX, floorY + 0.21, 0));
    g.add(at(box(0.04, 0.18, 0.55, new THREE.MeshStandardMaterial({ color: '#30353d', roughness: 0.7 }), 0.02), bunkX + 0.33, floorY + 0.22, 0));
    g.add(at(box(0.02, 0.025, 0.22, trimAlu, 0.01), bunkX + 0.355, floorY + 0.3, 0));
    g.add(at(box(0.66, 0.14, W - 0.3, new THREE.MeshStandardMaterial({ color: '#3b4250', roughness: 0.95, map: fabricTexture('#3b4250') }), 0.06), bunkX, floorY + 0.49, 0));
    g.add(at(box(0.36, 0.09, 0.46, new THREE.MeshStandardMaterial({ color: '#c3cad3', roughness: 1, envMapIntensity: 0.35 }), 0.045), bunkX, floorY + 0.6, hw - 0.45));
    const blanket = box(0.62, 0.05, 0.6, new THREE.MeshStandardMaterial({ color: '#1e3a5f', roughness: 1 }), 0.025);
    g.add(at(blanket, bunkX, floorY + 0.585, -0.4));
    if (roofY - floorY > 1.75) g.add(at(box(0.42, 0.4, W - 0.3, softLight, 0.04), -cabL + 0.27, roofY - 0.42, 0));
    // Reading lights by the bunk.
    for (const side of [-1, 1]) g.add(at(new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), glow('#fff4dc', 0.6)).rotateY(side > 0 ? Math.PI : 0), bunkX, floorY + 1.0, side * (hw - 0.085)));
  } else {
    g.add(at(box(0.04, roofY - floorY - 0.2, W - 0.2, soft, 0.02), -cabL + 0.08, floorY + (roofY - floorY) / 2, 0));
  }
  void p.rings;
  void p.doorBack;
  void p.plate;
  return g;
}

/** A van (3.5 t): bonnet, raked screen and a long body, as one smooth shell; or a cab with a box. */
function buildVan(look: TruckLook): BuiltTruck {
  const unit = powerUnitModel(look.modelId);
  const tuning = look.tuning ?? look.cosmetics?.tuning ?? {};
  const night = !!look.night;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const set: WheelSet = { wheels: [] };
  const parts = new Map<string, THREE.Object3D[]>();
  const paint = paintMat(look.color, look.condition ?? 100);
  const plate = look.plate ?? 'TV 0000 BG';
  const lift = tuning.stance === 'low' ? -0.06 : tuning.stance === 'high' ? 0.08 : 0;
  body.position.y = lift;
  const W = 2.03;
  const hw = W / 2;
  const L = 5.95;
  const boxVan = unit.look === 'box-van';
  const shellL = boxVan ? 2.2 : L;
  const rings: Ring[] = [
    { y: 0.3, xf: -0.04, xb: -shellL, h: hw - 0.03, rf: 0.24, rb: 0.08 },
    { y: 0.62, xf: 0, xb: -shellL, h: hw - 0.01, rf: 0.3, rb: 0.08 },
    { y: 0.98, xf: -0.06, xb: -shellL, h: hw, rf: 0.34, rb: 0.08 },
    { y: 1.1, xf: -0.5, xb: -shellL, h: hw - 0.02, rf: 0.36, rb: 0.08 },
    { y: 1.18, xf: -0.72, xb: -shellL, h: hw - 0.03, rf: 0.34, rb: 0.08 },
    { y: 2.3, xf: -1.55, xb: -shellL, h: hw - 0.08, rf: 0.3, rb: 0.1 },
    { y: 2.52, xf: -1.8, xb: -shellL + 0.04, h: hw - 0.14, rf: 0.3, rb: 0.14 },
  ];
  // Wheel arches cut out of the sides.
  const vanAxles = [-0.95, -4.55];
  const archR = 0.47;
  const archHoles = (sm: number, y: number, r: Ring) => {
    const [x] = ringPoint(r, sm < 0 ? sm + 1 : sm);
    return vanAxles.some((ax) => (x - ax) ** 2 + (y - 0.37) ** 2 < archR * archR);
  };
  const shell = new THREE.Mesh(loftGeometry(rings, 200, 3, { holes: archHoles, extraY: [0.4, 0.5, 0.6, 0.7, 0.8] }), paint);
  shell.castShadow = true;
  shell.userData.shell = true;
  body.add(shell);
  const glass = M.glass();
  const ws = shellPatch(rings, 1.24, 2.26, () => [-(SEG[0]! + 0.05), SEG[0]! + 0.05], 0.008, glass, 30, 5);
  ws.userData.glass = true;
  body.add(ws);
  for (const side of [-1, 1]) {
    const sw = shellPatch(rings, 1.28, 2.2, (r) => { const a = sideS(r, r.xf - r.rf - 0.05, side); const b = sideS(r, -2.15, side); return side > 0 ? [a, b] : [b, a]; }, 0.007, glass, 8, 4);
    sw.userData.glass = true;
    body.add(sw);
    const mirror = box(0.1, 0.3, 0.2, new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.5 }), 0.04);
    body.add(at(mirror, -0.95, 1.4, side * (hw + 0.17)));
    body.add(at(box(0.04, 0.04, 0.16, M.plastic(), 0.01), -0.95, 1.35, side * (hw + 0.06)));
    if (!boxVan) {
      const r0 = ringAt(rings, 0.6);
      const s = sideS(r0, -2.25, side);
      body.add(shellPatch(rings, 0.5, 2.25, () => [s - 0.0011, s + 0.0011], 0.004, new THREE.MeshStandardMaterial({ color: '#0a0c0f', side: THREE.DoubleSide }), 1, 6));
    }
  }
  if (boxVan) {
    const bL = L - shellL - 0.1;
    body.add(at(box(bL, 2.2, W + 0.12, M.white(), 0.05), -shellL - 0.1 - bL / 2, 1.55, 0));
  }
  // Arch liners.
  for (const ax of vanAxles) for (const side of [-1, 1]) body.add(mudguard(ax, 0.36, 0.24, side * (hw - 0.12), 'top'));
  // Face: a large grille with a chrome bar and the badge, swept headlights, bumper with fogs.
  const vg = new THREE.Shape();
  vg.moveTo(-0.55, 0.92);
  vg.lineTo(0.55, 0.92);
  vg.lineTo(0.45, 0.62);
  vg.lineTo(-0.45, 0.62);
  vg.lineTo(-0.55, 0.92);
  const vgm = new THREE.Mesh(new THREE.ShapeGeometry(vg), new THREE.MeshStandardMaterial({ color: '#0a0b0e', roughness: 0.6, normalMap: corrugatedNormal(90) }));
  vgm.rotation.y = Math.PI / 2;
  body.add(at(vgm, 0.012, 0, 0));
  body.add(at(box(0.03, 0.035, 1.05, M.chrome(), 0.012), 0.02, 0.84, 0));
  const vb = decalPlane(0.36, 0.07, new THREE.MeshStandardMaterial({ map: badgeTexture(unit.brand), transparent: true, metalness: 0.9, roughness: 0.2 }));
  vb.rotation.y = Math.PI / 2;
  body.add(at(vb, 0.04, 0.84, 0));
  for (const side of [-1, 1]) {
    const hl = box(0.1, 0.17, 0.42, new THREE.MeshStandardMaterial({ color: '#0d1014', roughness: 0.25, metalness: 0.5 }), 0.05);
    hl.rotation.y = side * 0.35;
    body.add(at(hl, -0.08, 0.93, side * (hw - 0.26)));
    const drl = box(0.015, 0.02, 0.36, emissive('#ffffff', night ? 2.4 : 1.4), 0.006);
    drl.rotation.y = side * 0.35;
    body.add(at(drl, -0.025, 0.97, side * (hw - 0.26)));
    const beam = cyl(0.045, 0.045, 0.02, emissive('#fffaf0', night ? 2.6 : 0.4), 20);
    beam.rotation.z = Math.PI / 2;
    body.add(at(beam, -0.02, 0.91, side * (hw - 0.2)));
    body.add(at(cyl(0.035, 0.035, 0.02, emissive('#fffbeb', night ? 1.4 : 0.2), 16).rotateZ(Math.PI / 2), 0.04, 0.42, side * (hw - 0.22)));
  }
  body.add(at(box(0.22, 0.26, W + 0.02, M.plastic(), 0.08), -0.05, 0.42, 0));
  const pl = decalPlane(0.52, 0.11, new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.4 }));
  pl.rotation.y = Math.PI / 2;
  body.add(at(pl, 0.085, 0.5, 0));
  rearLights(body, -L - 0.01, 0.95, hw, night);
  const rpl = decalPlane(0.52, 0.11, new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.4 }));
  rpl.rotation.y = -Math.PI / 2;
  body.add(at(rpl, -L - 0.02, 0.6, 0));
  const rimColor = RIM_COLORS[tuning.rims ?? 'steel'] ?? RIM_COLORS.steel!;
  axle(root, vanAxles[0]!, 1.75, 0.36, 'van', rimColor, set);
  axle(root, vanAxles[1]!, 1.75, 0.36, 'van', rimColor, set);
  if (tuning.decal) {
    const tex = decalTexture(tuning.decal);
    const objs: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const r0 = ringAt(rings, 0.8);
      const a = sideS(r0, -2.4, side);
      const b = sideS(r0, -5.6, side);
      objs.push(shellPatch(rings, 0.55, 1.9, () => (side > 0 ? [a, b] : [b, a]), 0.007, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.3 }), 16, 3));
    }
    for (const o of objs) body.add(o);
    parts.set('decal', objs);
  }
  if (tuning.bullbar) {
    const m = tuning.bullbar === 'chrome' ? M.chrome() : new THREE.MeshStandardMaterial({ color: '#111318', roughness: 0.35, metalness: 0.6 });
    const objs = [tube([new THREE.Vector3(-0.2, 0.55, -hw + 0.1), new THREE.Vector3(0.18, 0.6, -0.4), new THREE.Vector3(0.2, 0.62, 0), new THREE.Vector3(0.18, 0.6, 0.4), new THREE.Vector3(-0.2, 0.55, hw - 0.1)], 0.035, m, 40)];
    for (const o of objs) body.add(o);
    parts.set('bullbar', objs);
  }
  const bbox = new THREE.Box3().setFromObject(root);
  const cx = (bbox.min.x + bbox.max.x) / 2;
  root.children.forEach((c) => (c.position.x -= cx));
  return { group: root, length: bbox.max.x - bbox.min.x, wheels: set.wheels, parts, eye: new THREE.Vector3(-1.95 - cx, 1.75 + lift, -0.4), cab: { frontX: -cx - 0.8, length: 1.6, height: 2.5 + lift, width: W, floorY: 0.85 + lift } };
}

function decalTexture(kind: string) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  if (kind === 'flame') {
    for (let i = 0; i < 7; i++) {
      const y = 330 + i * 18;
      const grd = g.createLinearGradient(0, 0, 1024, 0);
      grd.addColorStop(0, 'rgba(250,204,21,0)');
      grd.addColorStop(0.35, '#facc15');
      grd.addColorStop(0.7, '#f97316');
      grd.addColorStop(1, '#b91c1c');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(1024, y + 60);
      for (let x = 1024; x > 200; x -= 90) g.quadraticCurveTo(x - 45, y - 80 - (i % 3) * 30, x - 90, y + 10);
      g.lineTo(1024, y + 120);
      g.fill();
    }
  } else if (kind === 'racing') {
    g.fillStyle = '#f8fafc';
    g.fillRect(0, 300, 1024, 44);
    g.fillRect(0, 370, 1024, 22);
    g.fillStyle = '#0f172a';
    g.fillRect(0, 344, 1024, 8);
  } else if (kind === 'stars') {
    g.fillStyle = '#facc15';
    for (let i = 0; i < 9; i++) {
      const x = 120 + i * 100;
      const y = 300 + (i % 2) * 70;
      const r = 26 + (i % 3) * 8;
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = k % 2 ? r * 0.45 : r;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A semi-trailer by its body; returns its length and where the kingpin is (m from its front). */
function buildTrailer(trailerId: string, color: string, set: WheelSet, night: boolean, plate: string, company: string | null) {
  const t = trailerModel(trailerId);
  const g = new THREE.Group();
  const width = 2.55;
  const halfW = width / 2;
  const length = t.body === 'lowbed' ? 15.5 : t.body === 'container' ? 12.4 : 13.6;
  const front = length / 2;
  const kingpinFromFront = 1.2;
  const radius = 0.53;
  const deckY = t.body === 'lowbed' ? 0.95 : 1.38;
  const paint = paintMat(color, 100);

  // Chassis beams, landing gear, axles with mudguards, guards, lights.
  for (const side of [-1, 1]) g.add(at(box(length - 0.4, 0.32, 0.12, M.frame(), 0.01), 0, deckY - 0.12, side * 0.5));
  if (t.body !== 'lowbed') {
    for (const side of [-1, 1]) {
      const leg = box(0.12, deckY - 0.25, 0.12, M.steel(), 0.02);
      g.add(at(leg, front - 3.2, (deckY - 0.25) / 2 + 0.15, side * 0.85));
      g.add(at(box(0.3, 0.05, 0.3, M.frame(), 0.01), front - 3.2, 0.1, side * 0.85));
    }
    g.add(at(box(0.05, 0.05, 1.7, M.steel(), 0.01), front - 3.2, 0.7, 0));
    const crank = cyl(0.015, 0.015, 0.4, M.chrome(), 8);
    crank.rotation.x = Math.PI / 2;
    g.add(at(crank, front - 3.2, 0.95, halfW - 0.05));
  }
  const axles = Math.max(2, t.axles ?? 3);
  const lastX = -length / 2 + 1.5;
  for (let i = 0; i < axles; i++) axle(g, lastX + i * 1.31, 2.05, radius, 'trailer', RIM_COLORS.alloy!, set);
  const groupMid = lastX + ((axles - 1) * 1.31) / 2;
  const groupSpan = (axles - 1) * 1.31 + radius * 2 + 0.3;
  for (const side of [-1, 1]) {
    g.add(at(box(groupSpan, 0.04, 0.55, new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.8 }), 0.01), groupMid, radius * 2 + 0.1, side * (halfW - 0.3)));
    g.add(mudflap(lastX - radius - 0.2, side * (halfW - 0.3)));
    // Side underrun guard between the landing gear and the axles.
    const guardL = front - 3.4 - (lastX + (axles - 1) * 1.31 + radius + 0.2);
    if (guardL > 0.5) for (const y of [0.5, 0.82]) g.add(at(box(guardL, 0.1, 0.05, M.alu(), 0.01), front - 3.4 - guardL / 2, y, side * (halfW - 0.08)));
  }
  // Rear: underrun bar, lights, plate.
  g.add(at(box(0.12, 0.14, width - 0.2, M.alu(), 0.02), -length / 2 + 0.1, 0.55, 0));
  rearLights(g, -length / 2 + 0.05, deckY - 0.2, halfW, night);
  const pl = decalPlane(0.52, 0.11, new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.4 }));
  pl.rotation.y = -Math.PI / 2;
  g.add(at(pl, -length / 2 + 0.03, deckY - 0.45, 0));

  const top = deckY + 0.06;
  const h = 2.75;
  const bodyMat = t.body === 'reefer' ? M.white() : paint;
  if (t.body === 'curtain' || t.body === 'livestock') {
    // Front wall, roof, rails; curtains with folds; buckle straps; rear doors.
    g.add(at(box(0.08, h, width, bodyMat, 0.04), front - 0.04, top + h / 2, 0));
    g.add(at(box(length, 0.1, width + 0.02, M.alu(), 0.02), 0, top + h, 0));
    g.add(at(box(length, 0.14, width + 0.04, M.alu(), 0.02), 0, top, 0));
    const curtainM = t.body === 'livestock'
      ? new THREE.MeshStandardMaterial({ color: '#cbd5e1', normalMap: corrugatedNormal(60), roughness: 0.35, metalness: 0.7 })
      : new THREE.MeshStandardMaterial({ color, normalMap: curtainNormal(), normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.75, metalness: 0 });
    if (curtainM.normalMap) {
      curtainM.normalMap = curtainM.normalMap.clone();
      curtainM.normalMap.needsUpdate = true;
      curtainM.normalMap.wrapS = THREE.RepeatWrapping;
      curtainM.normalMap.repeat.set(length / 2.5, 1);
    }
    for (const side of [-1, 1]) {
      const curtain = decalPlane(length - 0.2, h - 0.12, curtainM);
      if (side < 0) curtain.rotation.y = Math.PI;
      g.add(at(curtain, 0, top + h / 2 + 0.02, side * (halfW + 0.005)));
      for (let x = -length / 2 + 0.5; x < length / 2 - 0.3; x += 0.62) g.add(at(box(0.05, 0.4, 0.02, M.plastic(), 0.005), x, top + 0.26, side * (halfW + 0.015)));
      const strip = contourStrip(length - 0.4);
      if (side < 0) strip.rotation.y = Math.PI;
      g.add(at(strip, 0, top - 0.03, side * (halfW + 0.03)));
      if (company && t.body === 'curtain') {
        const name = decalPlane(length * 0.55, 0.85, new THREE.MeshStandardMaterial({ map: textTexture(company, '#f8fafc'), transparent: true, roughness: 0.7 }));
        if (side < 0) name.rotation.y = Math.PI;
        g.add(at(name, 0.3, top + h * 0.58, side * (halfW + 0.012)));
      }
    }
    rearDoors(g, -length / 2, top, h, width);
  } else if (t.body === 'reefer') {
    g.add(at(box(length, h, width, M.white(), 0.08), 0, top + h / 2, 0));
    const unit = box(0.5, 1.9, 2.1, new THREE.MeshStandardMaterial({ color: '#d1d5db', roughness: 0.45, metalness: 0.3 }), 0.06);
    g.add(at(unit, front + 0.25, top + h - 1.05, 0));
    g.add(at(box(0.02, 1.2, 1.6, new THREE.MeshStandardMaterial({ color: '#1f2937', normalMap: corrugatedNormal(30), roughness: 0.6 }), 0.01), front + 0.51, top + h - 1.0, 0));
    for (const side of [-1, 1]) {
      const strip = contourStrip(length - 0.4);
      if (side < 0) strip.rotation.y = Math.PI;
      g.add(at(strip, 0, top + 0.08, side * (halfW + 0.006)));
    }
    rearDoors(g, -length / 2, top, h, width);
  } else if (t.body === 'container') {
    // A 40 ft box on a skeletal chassis.
    const cm = new THREE.MeshStandardMaterial({ color, normalMap: corrugatedNormal(48), roughness: 0.55, metalness: 0.35 });
    cm.normalMap = cm.normalMap!.clone();
    cm.normalMap.needsUpdate = true;
    cm.normalMap.wrapS = THREE.RepeatWrapping;
    cm.normalMap.repeat.set(length / 3, 1);
    const ch = 2.59;
    g.add(at(box(12.19, ch, 2.44, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.3 }), 0.02), 0, top + ch / 2, 0));
    for (const side of [-1, 1]) {
      const panel = decalPlane(12.0, ch - 0.12, cm);
      if (side < 0) panel.rotation.y = Math.PI;
      g.add(at(panel, 0, top + ch / 2, side * 1.225));
    }
    for (const x of [-6.07, 6.07]) for (const y of [top + 0.08, top + ch - 0.08]) for (const z of [-1.17, 1.17]) g.add(at(box(0.18, 0.12, 0.16, M.steel(), 0.01), x, y, z));
    rearDoors(g, -6.1, top, ch, 2.44);
  } else if (t.body === 'tanker') {
    const tm = new THREE.MeshStandardMaterial({ color: '#dfe4ea', roughness: 0.18, metalness: 0.95 });
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(1.15, length - 2.7, 10, 40), tm);
    tank.rotation.z = Math.PI / 2;
    tank.castShadow = true;
    g.add(at(tank, 0, top + 1.15, 0));
    for (let x = -length / 2 + 1.6; x < length / 2 - 1.2; x += 2.2) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.025, 8, 48), M.steel());
      band.rotation.y = Math.PI / 2;
      g.add(at(band, x, top + 1.15, 0));
    }
    // Walkway with a railing, manholes, a ladder at the back.
    g.add(at(box(length - 3, 0.04, 0.5, M.alu(), 0.01), 0, top + 2.33, 0));
    for (let x = -length / 2 + 2; x < length / 2 - 1.5; x += 2.2) g.add(at(cyl(0.25, 0.25, 0.1, M.alu(), 20), x, top + 2.33, 0));
    for (const z of [-0.3, 0.3]) g.add(at(box(length - 3.2, 0.03, 0.03, M.alu(), 0.01), 0, top + 2.75, z));
    for (let y = 0; y < 7; y++) g.add(at(box(0.04, 0.03, 0.42, M.alu(), 0.01), -length / 2 + 0.55, top + 0.35 + y * 0.3, 0));
    g.add(at(box(2, 0.12, width, M.frame(), 0.01), 0, top - 0.02, 0));
  } else if (t.body === 'tipper') {
    const tubL = length - 1.4;
    const tub = new THREE.Shape();
    tub.moveTo(0, 0);
    tub.lineTo(tubL, 0);
    tub.lineTo(tubL + 0.15, 1.75);
    tub.lineTo(-0.2, 1.75);
    tub.lineTo(0, 0);
    const tubMesh = extrude(tub, width, paint, 0.05);
    g.add(at(tubMesh, -length / 2 + 0.5, top, 0));
    for (let x = -length / 2 + 1; x < length / 2 - 1; x += 0.8) for (const side of [-1, 1]) g.add(at(box(0.08, 1.7, 0.05, paint, 0.01), x, top + 0.87, side * (halfW + 0.04)));
    const ram = cyl(0.11, 0.11, 2.0, M.chrome(), 16);
    ram.rotation.z = 0.1;
    g.add(at(ram, front - 0.6, top + 0.8, 0));
  } else {
    // Flatbed / lowbed / car carrier: a wooden deck with stake pockets and a load of pallets.
    const deckL = t.body === 'lowbed' ? length - 3.5 : length;
    const deck = box(deckL, 0.12, width, new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 }), 0.02);
    g.add(at(deck, t.body === 'lowbed' ? -1.6 : 0, top, 0));
    if (t.body === 'lowbed') {
      g.add(at(box(3.2, 0.5, width, paint, 0.04), front - 1.6, top + 0.45, 0));
      g.add(at(box(0.4, 0.5, width, paint, 0.04), front - 3.25, top + 0.25, 0));
    }
    for (let x = -deckL / 2 + 0.5; x < deckL / 2; x += 1.2) for (const side of [-1, 1]) g.add(at(box(0.06, 0.6, 0.06, M.steel(), 0.01), x + (t.body === 'lowbed' ? -1.6 : 0), top + 0.3, side * (halfW - 0.02)));
    if (t.body === 'flatbed') for (let i = 0; i < 6; i++) {
      const pallet = box(1.15, 1.0, 1.1, new THREE.MeshStandardMaterial({ color: i % 2 ? '#c8a979' : '#b89363', roughness: 0.9 }), 0.03);
      g.add(at(pallet, -length / 2 + 1.2 + i * 1.9, top + 0.56, 0.6 * (i % 2 ? 1 : -1)));
      g.add(at(box(1.16, 0.04, 1.11, new THREE.MeshStandardMaterial({ color: '#cbd5e1', transparent: true, opacity: 0.5 }), 0.01), -length / 2 + 1.2 + i * 1.9, top + 1.07, 0.6 * (i % 2 ? 1 : -1)));
    }
    for (const side of [-1, 1]) {
      const strip = contourStrip(deckL - 0.2);
      if (side < 0) strip.rotation.y = Math.PI;
      g.add(at(strip, t.body === 'lowbed' ? -1.6 : 0, top - 0.05, side * (halfW + 0.005)));
    }
  }
  return { group: g, length, kingpinFromFront };
}

/** Two rear doors with lock rods and hinges. */
function rearDoors(g: THREE.Group, x: number, top: number, h: number, width: number) {
  const door = M.white();
  for (const side of [-1, 1]) {
    const d = box(0.05, h - 0.1, width / 2 - 0.03, door, 0.02);
    g.add(at(d, x - 0.03, top + h / 2, side * (width / 4)));
    for (const dz of [-0.3, 0.3]) g.add(at(cyl(0.02, 0.02, h - 0.2, M.chrome(), 8), x - 0.07, top + h / 2, side * (width / 4) + dz * 0.8));
    for (const y of [0.4, h - 0.4]) g.add(at(box(0.06, 0.1, 0.16, M.steel(), 0.01), x - 0.06, top + y, side * (width / 2 - 0.04)));
  }
  const strip = contourStrip(width - 0.2);
  strip.rotation.y = -Math.PI / 2;
  g.add(at(strip, x - 0.065, top + 0.12, 0));
}

/** Frees the GPU memory of everything under `o` (shared canvas textures are kept). */
export function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh || c instanceof THREE.Points || c instanceof THREE.Sprite) {
      c.geometry?.dispose();
      const ms = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of ms) m.dispose();
    }
  });
}
