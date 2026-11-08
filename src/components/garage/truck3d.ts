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
import { badgeTexture, contourTexture, corrugatedNormal, curtainNormal, plateTexture, textTexture, treadTexture, woodTexture } from './textures';

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
const CAB_HEIGHT: Record<string, number> = { van: 2.55, day: 3.0, sleeper: 3.4, highline: 3.85 };
const RIM_COLORS: Record<string, string> = { steel: '#c3c9d1', alloy: '#e2e6eb', chrome: '#f8fafc', black: '#15181d' };

// ---------------------------------------------------------------- materials

const M = {
  rubber: () => new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.92, metalness: 0, map: treadTexture() }),
  sidewall: () => new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.85 }),
  plastic: () => new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.75, metalness: 0.05 }),
  frame: () => new THREE.MeshStandardMaterial({ color: '#1a1d22', roughness: 0.6, metalness: 0.4 }),
  alu: () => new THREE.MeshStandardMaterial({ color: '#d5dae0', roughness: 0.32, metalness: 0.9 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.08, metalness: 1 }),
  steel: () => new THREE.MeshStandardMaterial({ color: '#6b7280', roughness: 0.5, metalness: 0.7 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: '#0d1620', roughness: 0.03, metalness: 0.2, transparent: true, opacity: 0.88, envMapIntensity: 1.6, clearcoat: 1, side: THREE.DoubleSide }),
  lens: () => new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, metalness: 0, transparent: true, opacity: 0.25, clearcoat: 1 }),
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

function emissive(color: string, on: number) {
  return new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: on, roughness: 0.2 });
}

// ---------------------------------------------------------------- helpers

export function box(w: number, h: number, d: number, m: THREE.Material, r = 0.04) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rTop: number, rBottom: number, h: number, m: THREE.Material, seg = 24) {
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

const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => {
  o.position.set(x, y, z);
  return o;
};

// ---------------------------------------------------------------- wheels

/** A tyre on a rim, axis along z, outer face toward `side`. */
function wheel(radius: number, width: number, rimColor: string, side: number, opts: { dual?: boolean; trailer?: boolean } = {}) {
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

/** A plastic mudguard over a wheel: an arc around the axle. */
function mudguard(x: number, radius: number, width: number, z: number, arc = Math.PI * 0.62, start = Math.PI * 0.2) {
  const geo = new THREE.CylinderGeometry(radius + 0.09, radius + 0.09, width + 0.08, 28, 1, true, start, arc);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#16191e', roughness: 0.7, side: THREE.DoubleSide }));
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

// ---------------------------------------------------------------- the cab

/** The side profile of the cab (x forward from the back wall, y up from the floor). */
function cabShape(len: number, h: number, rake: number, nose: number, roofBump: number) {
  const s = new THREE.Shape();
  const belt = h * 0.48;
  s.moveTo(0, 0);
  s.lineTo(len - 0.12, 0);
  s.quadraticCurveTo(len + nose, 0.02, len + nose, 0.25);
  s.lineTo(len + nose * 0.6, belt);
  s.lineTo(len - rake, h - 0.22);
  s.quadraticCurveTo(len - rake - 0.06, h, len - rake - 0.32, h + roofBump * 0.3);
  if (roofBump > 0) {
    s.quadraticCurveTo(len * 0.55, h + roofBump, len * 0.3, h + roofBump);
    s.lineTo(0.15, h + roofBump);
    s.quadraticCurveTo(0, h + roofBump, 0, h + roofBump - 0.15);
  } else {
    s.lineTo(0.15, h);
    s.quadraticCurveTo(0, h, 0, h - 0.15);
  }
  s.lineTo(0, 0);
  return { shape: s, belt };
}

/** A van's profile: bonnet, raked windscreen, long roof. */
function vanShape(len: number, h: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(len - 0.15, 0);
  s.quadraticCurveTo(len + 0.05, 0.02, len + 0.05, 0.3);
  s.quadraticCurveTo(len + 0.02, 0.62, len - 0.25, 0.72);
  s.lineTo(len - 0.75, 0.9);
  s.lineTo(len - 1.55, h - 0.08);
  s.quadraticCurveTo(len - 1.7, h, len - 1.9, h);
  s.lineTo(0.12, h);
  s.quadraticCurveTo(0, h, 0, h - 0.12);
  s.lineTo(0, 0);
  return s;
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

/** A pane between two points of the profile (the windscreen), spanning the width, `out` m off the shell. */
function screen(x1: number, y1: number, x2: number, y2: number, width: number, m: THREE.Material, out = 0.09) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(len, width), m);
  p.rotation.x = -Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(p);
  // Along the line from the top down to the front; the pane's normal then points forward and up.
  const theta = Math.atan2(y1 - y2, x1 - x2);
  holder.rotation.z = theta;
  holder.position.set((x1 + x2) / 2 - Math.sin(theta) * out, (y1 + y2) / 2 + Math.cos(theta) * out, 0);
  return holder;
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

/** The power unit (and a trailer when given), in the truck's own frame. */
export function buildTruck(look: TruckLook): BuiltTruck {
  const unit = powerUnitModel(look.modelId);
  const style = BRAND_STYLE[unit.brand] ?? DEFAULT_STYLE;
  const tuning = look.tuning ?? look.cosmetics?.tuning ?? {};
  const cosmetics = look.cosmetics ?? {};
  const condition = look.condition ?? 100;
  const night = !!look.night;
  const root = new THREE.Group();
  const body = new THREE.Group(); // all but the wheels (rides higher or lower with the stance)
  root.add(body);
  const set: WheelSet = { wheels: [] };
  const parts = new Map<string, THREE.Object3D[]>();
  const addPart = (part: string, objs: THREE.Object3D[]) => {
    for (const o of objs) body.add(o);
    parts.set(part, objs);
  };
  const paint = paintMat(look.color, condition);
  const van = unit.kind === 'van';
  const width = van ? 2.05 : 2.5;
  const halfW = width / 2;
  const radius = van ? 0.36 : 0.53;
  const track = van ? 1.78 : 2.05;
  const lift = tuning.stance === 'low' ? -0.1 : tuning.stance === 'high' ? 0.14 : 0;
  body.position.y = lift;
  const rimColor = RIM_COLORS[tuning.rims ?? 'steel'] ?? RIM_COLORS.steel!;
  const glass = M.glass();
  const plate = look.plate ?? 'TV 0000 BG';

  // Overall layout along x (front at +x).
  const length = unit.kind === 'tractor' ? 6.3 : van ? 5.95 : 8.6;
  const frontX = length / 2;
  const cabL = van ? (unit.look === 'box-van' ? 2.3 : length - 0.2) : unit.cab === 'day' ? 1.95 : 2.3;
  const floorY = van ? 0.42 : 1.12;
  const cabH = van ? CAB_HEIGHT.van! - floorY : (CAB_HEIGHT[unit.cab] ?? 3.2) - floorY;
  const roofBump = !van && unit.cab === 'highline' ? 0.35 : 0;
  const cabBack = frontX - cabL;

  // ---- frame rails and chassis furniture (trucks)
  if (!van) {
    const railY = radius + 0.42;
    for (const side of [-1, 1]) {
      const rail = box(length - 0.5, 0.28, 0.09, M.frame(), 0.01);
      body.add(at(rail, -0.15, railY, side * 0.43));
    }
    for (let i = 0; i < 5; i++) body.add(at(box(0.1, 0.18, 0.86, M.frame(), 0.01), -length / 2 + 0.6 + i * ((length - 1.4) / 4), railY, 0));
    // Fuel tank (aluminium, strapped) on the right, battery box and air tanks on the left.
    const tank = box(1.45, 0.62, 0.62, M.alu(), 0.16);
    body.add(at(tank, cabBack - 0.9, railY - 0.25, halfW - 0.34));
    for (const dx of [-0.45, 0.45]) body.add(at(box(0.05, 0.66, 0.66, M.frame(), 0.01), cabBack - 0.9 + dx, railY - 0.25, halfW - 0.34));
    body.add(at(cyl(0.07, 0.07, 0.06, M.chrome(), 16), cabBack - 1.3, railY + 0.08, halfW - 0.34));
    const adblue = box(0.45, 0.45, 0.45, M.plastic(), 0.08);
    body.add(at(adblue, cabBack - 0.05, railY - 0.25, halfW - 0.3));
    body.add(at(box(0.08, 0.06, 0.08, emissive('#2563eb', 0.4), 0.01), cabBack - 0.05, railY + 0.0, halfW - 0.3));
    const battery = box(0.85, 0.55, 0.5, M.plastic(), 0.04);
    body.add(at(battery, cabBack - 0.6, railY - 0.25, -halfW + 0.32));
    for (let i = 0; i < 2; i++) {
      const air = cyl(0.13, 0.13, 0.8, M.steel(), 16);
      air.rotation.z = Math.PI / 2;
      body.add(at(air, cabBack - 1.65, railY - 0.3 + i * 0.27, -halfW + 0.42));
    }
    // Silencer box under the cab step (unless tuned stacks replace the look).
    const silencer = box(0.7, 0.5, 0.55, M.steel(), 0.06);
    body.add(at(silencer, cabBack + 0.4, railY - 0.25, -halfW + 0.35));
    // Rear: light bar, plate, underrun bar on a rigid; mudflaps.
    const rearX = -length / 2 + 0.05;
    rearLights(body, rearX + 0.1, railY - 0.15, halfW, night);
    if (unit.kind === 'rigid') {
      body.add(at(box(0.1, 0.12, width - 0.2, M.alu(), 0.02), rearX + 0.05, 0.55, 0));
      const pl = decalPlane(0.52, 0.11, new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.4 }));
      pl.rotation.y = -Math.PI / 2;
      body.add(at(pl, rearX + 0.04, railY - 0.35, 0));
    }
  }

  // ---- the cab shell
  if (van) {
    const shape = unit.look === 'box-van' ? cabShape(cabL, cabH, 0.65, 0.03, 0).shape : vanShape(cabL, cabH);
    const shell = extrude(shape, width, paint, 0.09);
    shell.position.set(cabBack, floorY, 0);
    shell.userData.shell = true;
    body.add(shell);
    // Windscreen along the raked screen line, and the cab side windows.
    const isBox = unit.look === 'box-van';
    const belt = cabH * 0.48;
    const sx1 = isBox ? cabBack + cabL + 0.03 : cabBack + cabL - 0.75;
    const sy1 = isBox ? floorY + belt + 0.06 : floorY + 0.92;
    const sx2 = isBox ? cabBack + cabL - 0.62 : cabBack + cabL - 1.53;
    const sy2 = isBox ? floorY + cabH - 0.26 : floorY + cabH - 0.1;
    const ws = screen(sx1, sy1, sx2, sy2, width - 0.3, glass, 0.1);
    ws.traverse((o) => (o.userData.glass = true));
    body.add(ws);
    for (const side of [-1, 1]) {
      const w = new THREE.Shape();
      const back = sx2 - 0.75;
      w.moveTo(back, sy1 + 0.05);
      w.lineTo(sx1 - 0.25, sy1 + 0.05);
      w.lineTo(sx2 + 0.05, sy2 - 0.08);
      w.lineTo(back, sy2 - 0.08);
      w.lineTo(back, sy1 + 0.05);
      const wm = new THREE.Mesh(new THREE.ShapeGeometry(w), glass);
      wm.position.z = side * (halfW + 0.003);
      wm.userData.glass = true;
      body.add(wm);
    }
    if (unit.look === 'box-van') {
      const boxL = length - cabL - 0.15;
      const cargo = box(boxL, 2.1, width + 0.08, M.white(), 0.06);
      body.add(at(cargo, -length / 2 + boxL / 2, floorY + 1.15, 0));
    }
  } else {
    const { shape, belt } = cabShape(cabL, cabH, style.rake, style.nose, roofBump);
    const shell = extrude(shape, width, paint, 0.08);
    shell.position.set(cabBack, floorY, 0);
    shell.userData.shell = true;
    body.add(shell);
    // Windscreen with a black rubber surround.
    const x1 = cabBack + cabL + style.nose * 0.6;
    const y1 = floorY + belt + 0.06;
    const x2 = cabBack + cabL - style.rake + 0.03;
    const y2 = floorY + cabH - 0.26;
    const surround = screen(x1, y1 - 0.05, x2, y2 + 0.06, width - 0.14, new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.6, side: THREE.DoubleSide }), 0.085);
    surround.traverse((o) => (o.userData.shell = true));
    body.add(surround);
    const ws = screen(x1, y1, x2, y2, width - 0.28, glass, 0.095);
    ws.traverse((o) => (o.userData.glass = true));
    body.add(ws);
    // Parked wipers along the bottom of the screen.
    for (const z of [-0.5, 0.35]) body.add(at(box(0.025, 0.025, 0.78, M.plastic(), 0.005), x1 + 0.1, y1 + 0.04, z));
    // Side windows and doors.
    const doorFront = cabBack + cabL - 0.12;
    const doorBack = cabBack + cabL * 0.32;
    for (const side of [-1, 1]) {
      const z = side * (halfW + 0.002);
      const win = new THREE.Shape();
      const wb = floorY + belt + 0.08;
      const wt = floorY + cabH - 0.3;
      win.moveTo(doorBack + 0.08, wb);
      win.lineTo(doorFront - 0.12, wb);
      win.lineTo(doorFront - 0.12 - style.rake * 0.7, wt);
      win.lineTo(doorBack + 0.08, wt);
      win.lineTo(doorBack + 0.08, wb);
      const wm = new THREE.Mesh(new THREE.ShapeGeometry(win), glass);
      wm.position.z = z;
      wm.userData.glass = true;
      body.add(wm);
      // Door gaps, handle, the steps cut in behind the wheel.
      const gapM = new THREE.MeshStandardMaterial({ color: '#0a0c0f', roughness: 0.8 });
      body.add(at(box(0.015, cabH * 0.86, 0.01, gapM, 0.002), doorBack, floorY + cabH * 0.43, z + side * 0.003));
      body.add(at(box(0.015, belt + 0.1, 0.01, gapM, 0.002), doorFront, floorY + (belt + 0.1) / 2, z + side * 0.003));
      body.add(at(box(0.22, 0.04, 0.035, M.chrome(), 0.01), doorBack + 0.2, floorY + belt - 0.05, z + side * 0.02));
      const grab = cyl(0.018, 0.018, 0.9, M.chrome(), 8);
      body.add(at(grab, doorBack - 0.05, floorY + belt * 0.75, z + side * 0.05));
      for (let k = 0; k < 2; k++) body.add(at(box(0.42, 0.05, 0.24, M.alu(), 0.01), doorFront - 0.55, 0.42 + k * 0.33, side * (halfW - 0.12)));
      // Side marker lights.
      body.add(at(box(0.08, 0.04, 0.02, emissive('#f59e0b', night ? 1.5 : 0.3), 0.01), doorFront - 0.1, floorY + 0.25, z + side * 0.01));
      // Mirrors on arms: main and wide-angle.
      const armM = M.plastic();
      const arm = cyl(0.025, 0.025, 0.42, armM, 8);
      arm.rotation.x = Math.PI / 2;
      body.add(at(arm, doorFront - 0.02, floorY + cabH - 0.55, side * (halfW + 0.2)));
      const mirror = box(0.14, 0.5, 0.26, paint, 0.06);
      body.add(at(mirror, doorFront + 0.02, floorY + cabH - 0.85, side * (halfW + 0.42)));
      const mGlass = decalPlane(0.22, 0.42, new THREE.MeshStandardMaterial({ color: '#9fb3c8', metalness: 1, roughness: 0.05 }));
      mGlass.rotation.y = -Math.PI / 2;
      body.add(at(mGlass, doorFront - 0.055, floorY + cabH - 0.85, side * (halfW + 0.42)));
      const wide = box(0.12, 0.24, 0.22, paint, 0.05);
      body.add(at(wide, doorFront + 0.02, floorY + cabH - 1.25, side * (halfW + 0.38)));
      // Company name on the door (the shop's sticker).
      if (cosmetics.sticker) {
        const tex = textTexture(cosmetics.sticker, '#f8fafc');
        const st = decalPlane(cabL * 0.62, 0.16, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4 }));
        if (side < 0) st.rotation.y = Math.PI;
        body.add(at(st, doorBack + cabL * 0.33, floorY + belt * 0.55, z + side * 0.004));
      }
    }
    // The face: grille with a surround, brand badge, headlights with DRL, bumper.
    const faceX = cabBack + cabL + style.nose * 0.6 + 0.09;
    const gH = belt - 0.55;
    const gW = width * 0.66;
    const gy = floorY + 0.5 + gH / 2;
    const surroundM = new THREE.MeshStandardMaterial({ color: GRILLE_COLORS[cosmetics.grille ?? 'black'] ?? '#0b1220', roughness: 0.15, metalness: cosmetics.grille && cosmetics.grille !== 'black' ? 1 : 0.3 });
    const chrome = cosmetics.grille === 'gold' ? new THREE.MeshStandardMaterial({ color: '#d4a017', roughness: 0.15, metalness: 1 }) : cosmetics.grille === 'black' ? new THREE.MeshStandardMaterial({ color: '#111318', roughness: 0.35, metalness: 0.6 }) : M.chrome();
    const grille = new THREE.Group();
    grille.add(box(0.05, gH, gW, new THREE.MeshStandardMaterial({ color: '#07090c', roughness: 0.8 }), 0.03));
    grille.add(at(box(0.04, gH + 0.08, 0.05, surroundM, 0.015), 0.02, 0, -gW / 2));
    grille.add(at(box(0.04, gH + 0.08, 0.05, surroundM, 0.015), 0.02, 0, gW / 2));
    grille.add(at(box(0.04, 0.05, gW + 0.04, surroundM, 0.015), 0.02, gH / 2, 0));
    if (style.grille === 'closed') {
      grille.add(at(box(0.04, gH * 0.9, gW * 0.95, paint, 0.03), 0.02, 0, 0));
      grille.add(at(box(0.03, 0.04, gW * 0.9, emissive('#7dd3fc', night ? 2.4 : 0.9), 0.01), 0.045, gH * 0.32, 0));
    } else {
      const n = style.grille === 'slats-v' ? 13 : style.grille === 'mesh' ? 9 : 6;
      for (let i = 0; i < n; i++) {
        const slat = style.grille === 'slats-v' ? box(0.04, gH * 0.92, 0.035, chrome, 0.008) : box(0.04, style.grille === 'mesh' ? 0.025 : 0.06, gW * 0.96, chrome, 0.012);
        if (style.grille === 'slats-v') slat.position.set(0.025, 0, -gW / 2 + 0.06 + ((gW - 0.12) / (n - 1)) * i);
        else slat.position.set(0.025, -gH / 2 + 0.07 + ((gH - 0.14) / (n - 1)) * i, 0);
        grille.add(slat);
      }
      if (style.grille === 'mesh') for (let i = 0; i < 11; i++) grille.add(at(box(0.04, gH * 0.92, 0.02, chrome, 0.005), 0.025, 0, -gW / 2 + 0.05 + ((gW - 0.1) / 10) * i));
    }
    grille.position.set(faceX - 0.02, gy, 0);
    body.add(grille);
    const badge = decalPlane(0.75, 0.14, new THREE.MeshStandardMaterial({ map: badgeTexture(unit.brand), transparent: true, metalness: 0.9, roughness: 0.2 }));
    badge.rotation.y = Math.PI / 2;
    body.add(at(badge, faceX + 0.03, floorY + belt - 0.02, 0));
    // Accent line under the windscreen.
    body.add(at(box(0.03, 0.05, width * 0.8, new THREE.MeshStandardMaterial({ color: style.accent, metalness: 0.6, roughness: 0.3 }), 0.01), faceX - 0.02, floorY + belt + 0.02, 0));
    // Headlights: dark housing, reflectors, a clear lens, the daytime running light.
    const ly = floorY + 0.28;
    for (const side of [-1, 1]) {
      const hz = side * (halfW - 0.42);
      const housing = box(0.1, style.lights === 'slim' ? 0.16 : 0.26, 0.6, new THREE.MeshStandardMaterial({ color: '#0d1014', roughness: 0.3, metalness: 0.5 }), 0.04);
      body.add(at(housing, faceX - 0.04, ly, hz));
      const beams = style.lights === 'quad' || style.lights === 'round' ? 2 : style.lights === 'slim' ? 3 : 2;
      for (let k = 0; k < beams; k++) {
        const r = style.lights === 'slim' ? 0.045 : 0.08;
        const lamp = new THREE.Mesh(style.lights === 'round' ? new THREE.CircleGeometry(r, 20) : new THREE.PlaneGeometry(r * 2.1, r * 1.6), emissive('#fff8e1', night ? 3 : 0.5));
        lamp.rotation.y = Math.PI / 2;
        body.add(at(lamp, faceX + 0.012, ly, hz + side * (-0.17 + k * (0.34 / Math.max(1, beams - 1)))));
      }
      body.add(at(box(0.015, 0.025, 0.5, emissive('#ffffff', night ? 2.5 : 1.4), 0.006), faceX + 0.015, ly + (style.lights === 'slim' ? 0.05 : 0.1), hz));
      const lens = box(0.02, style.lights === 'slim' ? 0.15 : 0.24, 0.58, M.lens(), 0.03);
      body.add(at(lens, faceX + 0.025, ly, hz));
      // Indicator at the corner.
      body.add(at(box(0.04, 0.08, 0.12, emissive('#f59e0b', 0.25), 0.02), faceX - 0.06, ly, side * (halfW - 0.05)));
      // Corner air deflector (cab colour).
      body.add(at(box(0.5, cabH * 0.62, 0.04, paint, 0.02), cabBack + cabL - 0.08, floorY + cabH * 0.55, side * (halfW + 0.04)));
    }
    // Bumper: three-part, with fog lights, the plate and a lower lip.
    const bumper = box(0.34, 0.44, width + 0.04, new THREE.MeshStandardMaterial({ color: '#2a2f37', roughness: 0.55, metalness: 0.2 }), 0.08);
    body.add(at(bumper, faceX - 0.14, floorY - 0.2, 0));
    body.add(at(box(0.3, 0.08, width - 0.1, M.plastic(), 0.03), faceX - 0.1, floorY - 0.44, 0));
    for (const side of [-1, 1]) {
      const fog = cyl(0.06, 0.06, 0.03, emissive('#fffbeb', night ? 1.5 : 0.2), 20);
      fog.rotation.z = Math.PI / 2;
      body.add(at(fog, faceX + 0.04, floorY - 0.24, side * (halfW - 0.3)));
    }
    const pl = decalPlane(0.52, 0.11, new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.4 }));
    pl.rotation.y = Math.PI / 2;
    body.add(at(pl, faceX + 0.035, floorY - 0.2, 0));
    // Sun visor: standard (body colour) unless a shop visor is fitted.
    const visorColor = cosmetics.visor === 'chrome' ? null : cosmetics.visor === 'black' ? '#0b1220' : null;
    const visorM = cosmetics.visor === 'chrome' ? M.chrome() : visorColor ? mat(visorColor, { roughness: 0.3 }) : paint;
    const visor = box(0.45, 0.06, width - 0.1, visorM, 0.03);
    visor.rotation.z = -0.25;
    body.add(at(visor, x2 + 0.18, floorY + cabH - 0.16, 0));
    // Roof: marker lights; a tractor gets an air deflector.
    for (const z of [-0.6, -0.2, 0.2, 0.6]) body.add(at(box(0.06, 0.05, 0.12, emissive('#f59e0b', night ? 1.4 : 0.25), 0.01), x2 - 0.1, floorY + cabH + roofBump * 0.3 + 0.03, z));
    if (unit.kind === 'tractor' && roofBump === 0) {
      const d = new THREE.Shape();
      d.moveTo(0, 0);
      d.lineTo(1.3, 0);
      d.quadraticCurveTo(0.8, 0.05, 0.1, 0.55);
      d.lineTo(0, 0.55);
      d.lineTo(0, 0);
      const defl = extrude(d, width - 0.2, paint, 0.04);
      body.add(at(defl, cabBack + 0.15, floorY + cabH - 0.02, 0));
    }
    // Rila: air horns.
    if (unit.brand === 'Rila Heavy') for (const side of [-1, 1]) {
      const horn = cyl(0.04, 0.08, 0.6, M.chrome(), 14);
      horn.rotation.z = Math.PI / 2;
      body.add(at(horn, cabBack + cabL - 0.8, floorY + cabH + roofBump + 0.08, side * 0.3));
    }
    // Shop roof lights.
    if (cosmetics.lights) {
      const c = LIGHT_COLORS[cosmetics.lights];
      body.add(at(box(0.12, 0.05, width * 0.8, M.chrome(), 0.02), x2 - 0.05, floorY + cabH + roofBump * 0.3 + 0.1, 0));
      for (let i = -2; i <= 2; i++) body.add(at(box(0.1, 0.14, 0.2, emissive(c, night ? 2.8 : 0.9), 0.03), x2 - 0.02, floorY + cabH + roofBump * 0.3 + 0.2, i * 0.4));
    }
  }

  // ---- the snow plough
  if (unit.look === 'plow') {
    const blade = box(0.25, 1.1, width * 1.3, mat('#f59e0b', { roughness: 0.4 }), 0.05);
    blade.rotation.y = 0.25;
    body.add(at(blade, frontX + 0.85, 0.7, 0));
    for (let i = 0; i < 6; i++) body.add(at(box(0.27, 0.12, 0.3, mat('#111827'), 0.01), frontX + 0.86, 0.95, -1.2 + i * 0.48));
  }

  // ---- a rigid's body
  if (unit.kind === 'rigid') {
    const bodyL = length - cabL - 0.35;
    const bodyH = 2.65;
    const by = radius * 2 + 0.25;
    const x0 = -length / 2 + bodyL / 2;
    const walls = M.white();
    body.add(at(box(bodyL, bodyH, width + 0.05, walls, 0.04), x0, by + bodyH / 2, 0));
    for (const x of [x0 - bodyL / 2, x0 + bodyL / 2]) for (const side of [-1, 1]) body.add(at(box(0.08, bodyH + 0.02, 0.08, M.alu(), 0.01), x, by + bodyH / 2, side * (halfW + 0.01)));
    body.add(at(box(bodyL, 0.08, width + 0.1, M.alu(), 0.01), x0, by + bodyH, 0));
    body.add(at(box(bodyL, 0.12, width + 0.1, M.alu(), 0.01), x0, by, 0));
    for (const side of [-1, 1]) {
      const strip = contourStrip(bodyL - 0.2, 'yellow');
      if (side < 0) strip.rotation.y = Math.PI;
      body.add(at(strip, x0, by + 0.15, side * (halfW + 0.035)));
      // Side underrun guard.
      body.add(at(box(2.6, 0.1, 0.05, M.alu(), 0.01), x0 + 1.0, 0.75, side * (halfW - 0.05)));
      body.add(at(box(2.6, 0.1, 0.05, M.alu(), 0.01), x0 + 1.0, 0.5, side * (halfW - 0.05)));
    }
    // Roller shutter at the back.
    const shutter = decalPlane(width - 0.2, bodyH - 0.2, new THREE.MeshStandardMaterial({ color: '#e5e7eb', normalMap: corrugatedNormal(40), roughness: 0.4, metalness: 0.4 }));
    shutter.rotation.y = -Math.PI / 2;
    shutter.rotation.z = Math.PI / 2;
    body.add(at(shutter, x0 - bodyL / 2 - 0.045, by + bodyH / 2, 0));
    if (unit.body === 'reefer') body.add(at(box(0.5, 0.9, 1.7, M.steel(), 0.05), x0 + bodyL / 2 + 0.01, by + bodyH - 0.55, 0));
    if (look.company) for (const side of [-1, 1]) {
      const name = decalPlane(bodyL * 0.7, 0.5, new THREE.MeshStandardMaterial({ map: textTexture(look.company, '#0f172a'), transparent: true }));
      if (side < 0) name.rotation.y = Math.PI;
      body.add(at(name, x0, by + bodyH * 0.6, side * (halfW + 0.03)));
    }
  }
  if (van && unit.look !== 'box-van') {
    // A panel van: sliding-door line and rear doors.
    const gapM = new THREE.MeshStandardMaterial({ color: '#0a0c0f', roughness: 0.8 });
    for (const side of [-1, 1]) body.add(at(box(0.015, cabH * 0.8, 0.01, gapM, 0.002), cabBack + cabL - 2.2, floorY + cabH * 0.42, side * (halfW + 0.004)));
    body.add(at(box(0.01, cabH * 0.85, 0.015, gapM, 0.002), cabBack - 0.004, floorY + cabH * 0.45, 0));
    rearLights(body, cabBack - 0.02, floorY + 0.55, halfW, night);
    const pl = decalPlane(0.52, 0.11, new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.4 }));
    pl.rotation.y = -Math.PI / 2;
    body.add(at(pl, cabBack - 0.095, floorY + 0.25, 0));
  }
  if (van) {
    // Van face: grille, lights, bumper and plate.
    const faceX = cabBack + cabL + 0.13;
    body.add(at(box(0.04, 0.22, 0.9, new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.5 }), 0.03), faceX - 0.04, floorY + 0.45, 0));
    for (let i = 0; i < 3; i++) body.add(at(box(0.04, 0.025, 0.86, M.chrome(), 0.01), faceX - 0.02, floorY + 0.38 + i * 0.07, 0));
    for (const side of [-1, 1]) {
      body.add(at(box(0.12, 0.16, 0.42, new THREE.MeshStandardMaterial({ color: '#0d1014', roughness: 0.3 }), 0.04), faceX - 0.12, floorY + 0.52, side * (halfW - 0.3)));
      body.add(at(box(0.02, 0.025, 0.36, emissive('#ffffff', night ? 2.2 : 1.2), 0.006), faceX - 0.05, floorY + 0.58, side * (halfW - 0.3)));
    }
    body.add(at(box(0.25, 0.28, width + 0.02, M.plastic(), 0.06), faceX - 0.15, floorY + 0.08, 0));
    const pl = decalPlane(0.52, 0.11, new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.4 }));
    pl.rotation.y = Math.PI / 2;
    body.add(at(pl, faceX - 0.02, floorY + 0.08, 0));
    for (const side of [-1, 1]) {
      const mirror = box(0.12, 0.28, 0.2, paint, 0.05);
      body.add(at(mirror, cabBack + cabL - 0.95, floorY + 1.15, side * (halfW + 0.16)));
    }
  }

  // ---- tuning (looks only)
  const cabTop = floorY + cabH + roofBump;
  if (tuning.spoiler && !van) {
    const h = tuning.spoiler === 'high' ? 0.75 : 0.4;
    const sp = new THREE.Shape();
    sp.moveTo(0, 0);
    sp.lineTo(1.4, 0);
    sp.quadraticCurveTo(0.9, h * 0.15, 0.15, h);
    sp.lineTo(0, h);
    sp.lineTo(0, 0);
    const spoiler = extrude(sp, width - 0.06, paint, 0.05);
    addPart('spoiler', [at(spoiler, cabBack + 0.05, cabTop - 0.02, 0)]);
  }
  if (tuning.skirts && !van) {
    const m = tuning.skirts === 'body' ? paint : tuning.skirts === 'chrome' ? M.chrome() : new THREE.MeshStandardMaterial({ color: '#0b0e12', roughness: 0.45 });
    const objs: THREE.Object3D[] = [];
    const span = unit.kind === 'tractor' ? 1.6 : 3.2;
    for (const side of [-1, 1]) objs.push(at(box(span, 0.5, 0.06, m, 0.03), cabBack - span / 2 - 0.05, radius + 0.22, side * (halfW + 0.01)));
    addPart('skirts', objs);
  }
  if (tuning.bullbar) {
    const m = tuning.bullbar === 'chrome' ? M.chrome() : new THREE.MeshStandardMaterial({ color: '#111318', roughness: 0.35, metalness: 0.6 });
    const objs: THREE.Object3D[] = [];
    const fx = van ? cabBack + cabL + 0.28 : cabBack + cabL + style.nose + 0.32;
    const by = van ? floorY + 0.1 : floorY - 0.15;
    for (const dy of [0, 0.36]) {
      const bar = cyl(0.05, 0.05, width * 0.95, m, 16);
      bar.rotation.x = Math.PI / 2;
      objs.push(at(bar, fx, by + dy, 0));
    }
    for (const z of [-0.85, -0.3, 0.3, 0.85]) objs.push(at(cyl(0.04, 0.04, 0.5, m, 10), fx, by + 0.18, z * (width / 2.4)));
    for (const z of [-0.5, 0.5]) {
      const spot = cyl(0.1, 0.1, 0.1, emissive('#fffbeb', night ? 2.2 : 0.3), 18);
      spot.rotation.z = Math.PI / 2;
      objs.push(at(spot, fx + 0.04, by + 0.5, z));
    }
    addPart('bullbar', objs);
  }
  if (tuning.exhaust && !van && !unit.electric) {
    const objs: THREE.Object3D[] = [];
    for (const side of tuning.exhaust === 'twin' ? [-1, 1] : [1]) {
      const h = cabH + floorY + 0.5;
      objs.push(at(cyl(0.085, 0.085, h, M.chrome(), 18), cabBack - 0.14, h / 2 + 0.6, side * (halfW - 0.18)));
      const tip = cyl(0.1, 0.085, 0.25, M.chrome(), 18);
      tip.rotation.z = -0.35;
      objs.push(at(tip, cabBack - 0.11, h + 0.65, side * (halfW - 0.18)));
      objs.push(at(box(0.04, 1.1, 0.2, M.steel(), 0.01), cabBack - 0.03, h - 0.1, side * (halfW - 0.18)));
    }
    addPart('exhaust', objs);
  }
  if (tuning.decal) {
    const objs: THREE.Object3D[] = [];
    const tex = decalTexture(tuning.decal);
    for (const side of [-1, 1]) {
      const d = decalPlane(cabL * 0.95, cabH * 0.42, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.3 }));
      if (side < 0) d.rotation.y = Math.PI;
      objs.push(at(d, cabBack + cabL * 0.5, floorY + cabH * 0.3, side * (halfW + 0.006)));
    }
    addPart('decal', objs);
  }

  // ---- wear: scratches and rust patches on the cab sides
  if (condition < 55) {
    const sm = new THREE.MeshStandardMaterial({ color: '#cfd5dc', roughness: 0.9 });
    for (let i = 0; i < (condition < 35 ? 9 : 5); i++) {
      const side = i % 2 ? 1 : -1;
      const sc = decalPlane(0.25 + (i % 3) * 0.12, 0.012, sm);
      sc.rotation.z = (i - 4) * 0.12;
      if (side < 0) sc.rotation.y = Math.PI;
      body.add(at(sc, cabBack + 0.3 + ((i * 0.37) % (cabL - 0.6)), floorY + 0.3 + ((i * 0.29) % 0.8), side * (halfW + 0.005)));
    }
  }
  if (condition < 35) {
    for (let i = 0; i < 7; i++) {
      const side = i % 2 ? 1 : -1;
      const rust = new THREE.Mesh(new THREE.CircleGeometry(0.06 + (i % 3) * 0.04, 12), new THREE.MeshStandardMaterial({ color: '#7c3f17', roughness: 1 }));
      if (side < 0) rust.rotation.y = Math.PI;
      body.add(at(rust, cabBack + 0.2 + i * 0.28, floorY + 0.12 + (i % 2) * 0.15, side * (halfW + 0.007)));
    }
  }

  // ---- wheels, mudguards, mudflaps
  const steerX = van ? frontX - 0.85 : frontX - 1.35;
  axle(root, steerX, track, radius, van ? 'van' : 'steer', rimColor, set);
  if (!van) for (const side of [-1, 1]) body.add(mudguard(steerX, radius, 0.32, side * (track / 2), Math.PI * 0.55, Math.PI * 0.25));
  const rearAxles = Math.max(1, unit.axles - 1);
  const firstRear = unit.kind === 'tractor' ? -length / 2 + 1.55 : van ? -length / 2 + 1.1 : -length / 2 + 2.4;
  for (let i = 0; i < rearAxles; i++) {
    const x = firstRear - i * 1.35;
    axle(root, x, track, radius, van ? 'van' : 'drive', rimColor, set);
  }
  if (!van) {
    const span = (rearAxles - 1) * 1.35 + radius * 2 + 0.3;
    const mx = firstRear - ((rearAxles - 1) * 1.35) / 2;
    for (const side of [-1, 1]) {
      body.add(at(box(span, 0.04, 0.72, new THREE.MeshStandardMaterial({ color: '#15181c', roughness: 0.8 }), 0.01), mx, radius * 2 + 0.12, side * (track / 2 - 0.2)));
      body.add(mudflap(firstRear - (rearAxles - 1) * 1.35 - radius - 0.18, side * (track / 2 - 0.2)));
    }
  }

  // ---- fifth wheel and the trailer
  let total = length;
  if (unit.kind === 'tractor') {
    const kingpinX = -length / 2 + 1.75;
    const fifth = new THREE.Group();
    fifth.add(box(1.0, 0.1, 1.1, new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.4, metalness: 0.6 }), 0.04));
    const plateTop = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 32), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.25, metalness: 0.8 }));
    plateTop.position.y = 0.07;
    fifth.add(plateTop);
    body.add(at(fifth, kingpinX, radius + 0.68, 0));
    if (look.trailerModelId) {
      const tr = buildTrailer(look.trailerModelId, look.trailerColor ?? '#e9edf1', set, night, plate, look.company ?? null);
      // The kingpin sits over the fifth wheel; the trailer's front overhangs it.
      tr.group.position.x = kingpinX + tr.kingpinFromFront - tr.length / 2;
      root.add(tr.group);
    }
  }

  // Centre the whole combination on its own origin.
  const bbox = new THREE.Box3().setFromObject(root);
  const cx = (bbox.min.x + bbox.max.x) / 2;
  total = bbox.max.x - bbox.min.x;
  root.children.forEach((c) => (c.position.x -= cx));
  const eye = new THREE.Vector3(cabBack + cabL - (van ? 1.9 : 1.15) - cx, floorY + (van ? 1.2 : 1.55) + lift, -halfW * (van ? 0.4 : 0.42));
  return { group: root, length: total, wheels: set.wheels, parts, eye, cab: { frontX: cabBack + cabL - cx, length: van ? 2.2 : cabL, height: floorY + cabH + lift, width, floorY: floorY + lift } };
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
