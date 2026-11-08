/**
 * 1.2.3.5: the player's truck in 3D, built from the catalogue (kind, cab, axles,
 * brand look), with its paint, parts, tuning and wear. 1 unit = 1 m, facing +x.
 * Original, stylised shapes for the game's fictional brands.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { GRILLE_COLORS, LIGHT_COLORS, type Cosmetics } from '@/lib/game/cosmetics';
import type { Tuning } from '@/lib/game/garage';

const CAB_HEIGHT: Record<string, number> = { van: 2.5, day: 2.9, sleeper: 3.3, highline: 3.75 };

type GrilleKind = 'slats-h' | 'slats-v' | 'mesh' | 'closed';
type LightKind = 'rect' | 'round' | 'slim' | 'quad';

/** Each fictional brand has its own face: cab roundness, grille, lights, windscreen slope. */
const BRAND_STYLE: Record<string, { radius: number; grille: GrilleKind; lights: LightKind; slope: number; accent: string }> = {
  Danubia: { radius: 0.24, grille: 'slats-h', lights: 'rect', slope: 0.12, accent: '#1e3a8a' },
  'Hemus Trucks': { radius: 0.1, grille: 'mesh', lights: 'rect', slope: 0.04, accent: '#334155' },
  'Iskar Steel': { radius: 0.08, grille: 'slats-v', lights: 'slim', slope: 0.22, accent: '#7f1d1d' },
  'Rila Heavy': { radius: 0.14, grille: 'slats-v', lights: 'quad', slope: 0.06, accent: '#713f12' },
  'Balkan Motors': { radius: 0.2, grille: 'slats-h', lights: 'round', slope: 0.1, accent: '#14532d' },
  'Volta Motors': { radius: 0.3, grille: 'closed', lights: 'slim', slope: 0.26, accent: '#0e7490' },
};
const DEFAULT_STYLE = BRAND_STYLE.Danubia!;

export function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15, ...opts });
}

export function box(w: number, h: number, d: number, m: THREE.Material, r = 0.06) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(r: number, h: number, m: THREE.Material, seg = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  mesh.castShadow = true;
  return mesh;
}

const RIM_COLORS: Record<string, string> = { steel: '#9aa3ad', alloy: '#d4d9e0', chrome: '#f1f5f9', black: '#111827' };

/** Wheels on both sides at x; returned so a test drive can spin them. */
function axle(group: THREE.Group, x: number, width: number, radius: number, dual: boolean, rimColor: string, wheels: THREE.Object3D[]) {
  const tyre = mat('#111318', { roughness: 0.9, metalness: 0 });
  const rim = mat(rimColor, { roughness: 0.25, metalness: 0.85 });
  for (const side of [-1, 1]) {
    for (const k of dual ? [0, 1] : [0]) {
      const w = new THREE.Group();
      const t = cyl(radius, 0.32, tyre, 28);
      t.rotation.x = Math.PI / 2;
      w.add(t);
      if (k === 0) {
        const r = cyl(radius * 0.58, 0.34, rim, 16);
        r.rotation.x = Math.PI / 2;
        r.position.z = side * 0.01;
        w.add(r);
        // Spokes, so the wheel is seen turning.
        for (let i = 0; i < 5; i++) {
          const s = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.9, 0.06, 0.05), mat('#64748b', { metalness: 0.6 }));
          s.rotation.z = (i / 5) * Math.PI;
          s.position.z = side * 0.18;
          w.add(s);
        }
      }
      w.position.set(x, radius, side * (width / 2 - 0.18 - k * 0.34));
      group.add(w);
      wheels.push(w);
    }
  }
}

export interface TruckLook {
  modelId: string;
  color: string;
  cosmetics?: Cosmetics | null;
  tuning?: Tuning | null;
  /** 0–100: below 80 the truck gets dusty, below 55 scratched, below 35 rusty. */
  condition?: number;
  night?: boolean;
  trailerModelId?: string | null;
  trailerColor?: string | null;
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
  cab: { frontX: number; length: number; height: number; width: number };
}

function decal(kind: string, cabL: number, cabH: number, width: number, frontX: number): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const z = side * (width / 2 + 0.012);
    if (kind === 'flame') {
      for (let i = 0; i < 4; i++) {
        const tri = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9 - i * 0.12, 3), mat(i % 2 ? '#f97316' : '#dc2626', { roughness: 0.4 }));
        tri.rotation.z = Math.PI / 2;
        tri.scale.z = 0.05;
        tri.position.set(frontX - 0.3 - i * 0.22, 1.35 + i * 0.12, z);
        out.push(tri);
      }
    } else if (kind === 'racing') {
      for (const dy of [0, 0.22]) {
        const s = box(cabL * 0.95, 0.1, 0.02, mat('#f8fafc', { roughness: 0.3 }), 0.01);
        s.position.set(frontX - cabL / 2, 1.5 + dy, z);
        out.push(s);
      }
    } else if (kind === 'stars') {
      for (let i = 0; i < 5; i++) {
        const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), mat('#facc15', { metalness: 0.7, roughness: 0.3 }));
        st.scale.z = 0.2;
        st.position.set(frontX - 0.35 - i * 0.28, 1.4 + (i % 2) * 0.25 + (cabH - 3) * 0.1, z);
        out.push(st);
      }
    }
  }
  return out;
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
  const body = new THREE.Group(); // everything but the wheels (rides higher or lower)
  root.add(body);
  const wheels: THREE.Object3D[] = [];
  const parts = new Map<string, THREE.Object3D[]>();
  const addPart = (part: string, objs: THREE.Object3D[]) => {
    for (const o of objs) body.add(o);
    parts.set(part, objs);
  };

  // Paint wears: dustier and duller as the condition drops.
  const paintColor = new THREE.Color(look.color).lerp(new THREE.Color('#8b7d6b'), condition < 80 ? (80 - condition) / 160 : 0);
  const paint = new THREE.MeshStandardMaterial({ color: paintColor, metalness: 0.4, roughness: 0.28 + (100 - condition) / 220 });
  const dark = mat('#1b2230', { roughness: 0.7 });
  const glass = mat('#0f1c2e', { roughness: 0.05, metalness: 0.9, opacity: 0.82, transparent: true });
  const chrome = mat(GRILLE_COLORS[cosmetics.grille ?? 'chrome'] ?? '#e2e8f0', { roughness: 0.18, metalness: 0.95 });
  const width = unit.kind === 'van' ? 2.0 : 2.5;
  const cabH = CAB_HEIGHT[unit.cab] ?? 3;
  const cabL = unit.kind === 'van' ? 1.7 : unit.cab === 'day' ? 1.9 : 2.3;
  const length = unit.kind === 'tractor' ? 6.2 : unit.kind === 'van' ? 5.6 : 8.4;
  const frontX = length / 2;
  const radius = unit.kind === 'van' ? 0.38 : 0.52;
  const lift = tuning.stance === 'low' ? -0.12 : tuning.stance === 'high' ? 0.16 : 0;
  body.position.y = lift;

  // Chassis.
  const chassis = box(length - 0.4, 0.28, width * 0.62, dark, 0.03);
  chassis.position.set(0, 0.95, 0);
  body.add(chassis);
  // Cab with the brand's roundness; the upper part leans back by the brand's slope.
  const lowerH = (cabH - 1.1) * 0.5;
  const upperH = cabH - 1.1 - lowerH;
  const cabLow = box(cabL, lowerH, width, paint, style.radius * 0.6);
  cabLow.position.set(frontX - cabL / 2, 1.1 + lowerH / 2, 0);
  cabLow.userData.shell = true;
  body.add(cabLow);
  const upperL = cabL - style.slope;
  const cabUp = box(upperL, upperH, width, paint, style.radius);
  cabUp.position.set(frontX - style.slope - upperL / 2, 1.1 + lowerH + upperH / 2 - 0.02, 0);
  cabUp.userData.shell = true;
  body.add(cabUp);
  // Brand accent line under the windscreen.
  const accent = box(0.03, 0.1, width * 0.9, mat(style.accent, { metalness: 0.5 }), 0.01);
  accent.position.set(frontX + 0.005, 1.1 + lowerH - 0.04, 0);
  body.add(accent);
  // Windscreen leaning with the slope, side windows, mirrors.
  const ws = box(0.06, upperH * 0.78, width * 0.86, glass, 0.02);
  ws.position.set(frontX - style.slope / 2 + 0.01, 1.1 + lowerH + upperH * 0.45, 0);
  ws.rotation.z = Math.atan2(style.slope, upperH);
  ws.userData.glass = true;
  body.add(ws);
  for (const side of [-1, 1]) {
    const sw = box(cabL * 0.42, upperH * 0.66, 0.04, glass, 0.02);
    sw.userData.glass = true;
    sw.position.set(frontX - cabL * 0.3, 1.1 + lowerH + upperH * 0.45, side * (width / 2 + 0.005));
    body.add(sw);
    const arm = box(0.3, 0.05, 0.05, dark, 0.01);
    arm.position.set(frontX - 0.05, 1.1 + lowerH + upperH * 0.55, side * (width / 2 + 0.12));
    body.add(arm);
    const mirror = box(0.12, 0.48, 0.12, dark, 0.03);
    mirror.position.set(frontX + 0.08, 1.1 + lowerH + upperH * 0.5, side * (width / 2 + 0.26));
    body.add(mirror);
    // Steps up to the door.
    for (const k of [0, 1]) {
      const step = box(0.45, 0.05, 0.22, mat('#94a3b8', { metalness: 0.7 }), 0.01);
      step.position.set(frontX - cabL * 0.55, 0.55 + k * 0.32, side * (width / 2 - 0.08));
      body.add(step);
    }
    // Door handle and the door gap.
    const gap = box(0.02, lowerH + upperH * 0.6, 0.015, dark, 0.005);
    gap.position.set(frontX - cabL + 0.2, 1.1 + (lowerH + upperH * 0.6) / 2, side * (width / 2 + 0.003));
    body.add(gap);
  }
  // Grille by the brand.
  const gH = Math.min(0.95, lowerH * 0.9);
  const gW = width * 0.62;
  const grille = new THREE.Group();
  grille.position.set(frontX + 0.025, 1.1 + gH / 2 + 0.02, 0);
  if (style.grille === 'closed') {
    const panel = box(0.05, gH, gW, mat('#0b1220', { roughness: 0.2, metalness: 0.6 }), 0.02);
    grille.add(panel);
    const strip = box(0.06, 0.05, gW, mat('#67e8f9', { emissive: new THREE.Color('#22d3ee'), emissiveIntensity: night ? 2 : 0.8 }), 0.01);
    strip.position.y = gH * 0.3;
    grille.add(strip);
  } else {
    const back = box(0.04, gH, gW, mat('#0b1220'), 0.02);
    grille.add(back);
    const n = style.grille === 'slats-v' ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const slat = style.grille === 'slats-v' ? box(0.05, gH * 0.94, 0.05, chrome, 0.01) : style.grille === 'mesh' ? box(0.05, 0.04, gW * 0.96, chrome, 0.01) : box(0.05, 0.08, gW * 0.96, chrome, 0.02);
      if (style.grille === 'slats-v') slat.position.z = -gW / 2 + (gW / (n - 1)) * i;
      else slat.position.y = -gH / 2 + 0.08 + ((gH - 0.16) / (n - 1)) * i;
      slat.position.x = 0.02;
      grille.add(slat);
    }
    if (style.grille === 'mesh') for (let i = 0; i < 7; i++) {
      const v = box(0.05, gH * 0.94, 0.03, chrome, 0.01);
      v.position.set(0.02, 0, -gW / 2 + (gW / 6) * i);
      grille.add(v);
    }
  }
  body.add(grille);
  // Bumper and lights by the brand.
  const bumper = box(0.28, 0.42, width, dark, 0.06);
  bumper.position.set(frontX - 0.04, 0.82, 0);
  body.add(bumper);
  const head = mat('#fff7d6', { emissive: new THREE.Color('#fff2b0'), emissiveIntensity: night ? 2.4 : 0.35, roughness: 0.1 });
  for (const side of [-1, 1]) {
    if (style.lights === 'round' || unit.look === 'classic') {
      for (const k of [0, 1]) {
        const l = cyl(0.12, 0.06, head, 20);
        l.rotation.z = Math.PI / 2;
        l.position.set(frontX + 0.13, 0.86, side * (width / 2 - 0.3 - k * 0.3));
        body.add(l);
      }
    } else if (style.lights === 'quad') {
      for (const k of [0, 1]) {
        const l = box(0.06, 0.15, 0.22, head, 0.02);
        l.position.set(frontX + 0.13, 0.86, side * (width / 2 - 0.25 - k * 0.27));
        body.add(l);
      }
    } else {
      const l = box(0.06, style.lights === 'slim' ? 0.08 : 0.17, style.lights === 'slim' ? 0.55 : 0.42, head, 0.02);
      l.position.set(frontX + 0.13, style.lights === 'slim' ? 0.98 : 0.88, side * (width / 2 - 0.36));
      body.add(l);
    }
    // Indicator.
    const ind = box(0.05, 0.08, 0.1, mat('#f59e0b', { emissive: new THREE.Color('#f59e0b'), emissiveIntensity: 0.3 }), 0.01);
    ind.position.set(frontX + 0.12, 0.88, side * (width / 2 - 0.05));
    body.add(ind);
  }
  // Rila: horns on the roof.
  if (unit.brand === 'Rila Heavy') for (const side of [-1, 1]) {
    const horn = cyl(0.06, 0.6, chrome, 12);
    horn.rotation.z = Math.PI / 2;
    horn.position.set(frontX - 0.6, cabH + 0.08, side * 0.35);
    body.add(horn);
  }
  // Fuel / battery tanks under the cab.
  for (const side of [-1, 1]) {
    const tank = unit.electric ? box(1.1, 0.5, 0.35, mat('#0e7490', { metalness: 0.4 }), 0.05) : cyl(0.28, 1.0, mat('#cbd5e1', { metalness: 0.85, roughness: 0.25 }), 18);
    if (!unit.electric) tank.rotation.z = Math.PI / 2;
    tank.position.set(frontX - cabL - 0.6, 0.75, side * (width / 2 - 0.2));
    if (unit.kind !== 'van') body.add(tank);
  }

  // Sun visor, roof lights (shop parts).
  if (cosmetics.visor) {
    const visorColor = cosmetics.visor === 'body' ? look.color : cosmetics.visor === 'black' ? '#0b1220' : '#e2e8f0';
    const visor = box(0.5, 0.08, width * 0.95, mat(visorColor, { metalness: cosmetics.visor === 'chrome' ? 0.9 : 0.3, roughness: 0.25 }), 0.03);
    visor.position.set(frontX + 0.1 - style.slope, cabH - 0.02, 0);
    body.add(visor);
  }
  if (cosmetics.lights) {
    const c = LIGHT_COLORS[cosmetics.lights];
    const lm = mat(c, { emissive: new THREE.Color(c), emissiveIntensity: night ? 2.6 : 0.9 });
    for (let i = -2; i <= 2; i++) {
      const b = box(0.12, 0.12, 0.16, lm, 0.03);
      b.position.set(frontX - 0.2 - style.slope, cabH + 0.08, i * 0.42);
      body.add(b);
    }
  }
  if (cosmetics.sticker) {
    for (const side of [-1, 1]) {
      const plate = box(cabL * 0.6, 0.22, 0.02, mat('#f8fafc', { roughness: 0.4 }), 0.01);
      plate.position.set(frontX - cabL / 2, 1.1 + lowerH * 0.5, side * (width / 2 + 0.012));
      body.add(plate);
    }
  }
  if (unit.look === 'plow') {
    const blade = box(0.25, 1.0, width * 1.25, mat('#f59e0b', { roughness: 0.4 }), 0.05);
    blade.position.set(frontX + 0.75, 0.75, 0);
    blade.rotation.y = 0.25;
    body.add(blade);
  }

  // Tuning (looks only).
  if (tuning.spoiler) {
    const h = tuning.spoiler === 'high' ? 0.7 : 0.35;
    const sp = box(1.2, h, width * 0.92, paint, 0.12);
    sp.position.set(frontX - cabL + 0.65, cabH + h / 2 - 0.02, 0);
    sp.rotation.z = 0.25;
    addPart('spoiler', [sp]);
  }
  if (tuning.skirts && unit.kind !== 'van') {
    const m = tuning.skirts === 'body' ? paint : tuning.skirts === 'chrome' ? mat('#f1f5f9', { metalness: 0.95, roughness: 0.15 }) : mat('#0b1220', { roughness: 0.5 });
    const objs: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const s = box(length * 0.42, 0.42, 0.06, m, 0.03);
      s.position.set(frontX - cabL - length * 0.21 - 0.2, 0.62, side * (width / 2 - 0.02));
      objs.push(s);
    }
    addPart('skirts', objs);
  }
  if (tuning.bullbar) {
    const m = tuning.bullbar === 'chrome' ? mat('#f1f5f9', { metalness: 0.95, roughness: 0.12 }) : mat('#111827', { roughness: 0.4, metalness: 0.5 });
    const objs: THREE.Object3D[] = [];
    const bar = cyl(0.06, width * 0.95, m, 14);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(frontX + 0.28, 1.0, 0);
    objs.push(bar);
    const low = bar.clone();
    low.position.y = 0.62;
    objs.push(low);
    for (const z of [-0.7, -0.25, 0.25, 0.7]) {
      const post = cyl(0.045, 0.45, m, 10);
      post.position.set(frontX + 0.28, 0.82, z * (width / 2.5));
      objs.push(post);
    }
    if (unit.kind !== 'van') for (const z of [-0.45, 0.45]) {
      const spot = cyl(0.11, 0.08, mat('#fff7d6', { emissive: new THREE.Color('#fff2b0'), emissiveIntensity: night ? 2 : 0.3 }), 16);
      spot.rotation.z = Math.PI / 2;
      spot.position.set(frontX + 0.33, 1.12, z);
      objs.push(spot);
    }
    addPart('bullbar', objs);
  }
  if (tuning.exhaust && unit.kind !== 'van' && !unit.electric) {
    const m = mat('#f1f5f9', { metalness: 0.95, roughness: 0.12 });
    const objs: THREE.Object3D[] = [];
    for (const side of tuning.exhaust === 'twin' ? [-1, 1] : [1]) {
      const pipe = cyl(0.09, cabH + 0.4, m, 14);
      pipe.position.set(frontX - cabL - 0.12, (cabH + 0.4) / 2 + 0.6, side * (width / 2 - 0.15));
      objs.push(pipe);
      const tip = cyl(0.11, 0.2, mat('#94a3b8', { metalness: 0.9 }), 14);
      tip.position.set(frontX - cabL - 0.12, cabH + 0.95, side * (width / 2 - 0.15));
      objs.push(tip);
    }
    addPart('exhaust', objs);
  }
  if (tuning.decal) addPart('decal', decal(tuning.decal, cabL, cabH, width, frontX));

  // Wear: scratches and rust.
  if (condition < 55) {
    const n = condition < 35 ? 7 : 4;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const sc = box(0.25 + (i % 3) * 0.1, 0.02, 0.01, mat('#cbd5e1', { roughness: 0.9 }), 0.004);
      sc.rotation.z = (i - 3) * 0.15;
      sc.position.set(frontX - 0.4 - (i * 0.27) % cabL, 1.3 + ((i * 0.37) % 1), side * (width / 2 + 0.008));
      body.add(sc);
    }
  }
  if (condition < 35) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      const rust = new THREE.Mesh(new THREE.CircleGeometry(0.08 + (i % 3) * 0.04, 10), mat('#8a4b20', { roughness: 1 }));
      rust.rotation.y = side > 0 ? 0 : Math.PI;
      rust.position.set(frontX - 0.3 - i * 0.3, 1.2 + (i % 2) * 0.2, side * (width / 2 + 0.014));
      body.add(rust);
    }
  }

  // Own body (rigid / van).
  if (unit.kind !== 'tractor') {
    const bodyL = length - cabL - 0.3;
    const bodyH = unit.kind === 'van' ? 1.6 : 2.6;
    const cargo = box(bodyL, bodyH, width, mat(unit.body === 'reefer' ? '#eef2f7' : '#e5e7eb', { roughness: 0.6 }), 0.08);
    cargo.position.set(-length / 2 + bodyL / 2, 1.15 + bodyH / 2, 0);
    body.add(cargo);
  }
  const rimColor = RIM_COLORS[tuning.rims ?? 'steel'] ?? RIM_COLORS.steel!;
  const axles = Math.max(2, unit.axles);
  axle(root, frontX - (unit.kind === 'van' ? 0.9 : 1.3), width, radius, false, rimColor, wheels);
  for (let i = 0; i < axles - 1; i++) axle(root, -length / 2 + (unit.kind === 'van' ? 1.0 : 1.4) + i * 1.35, width, radius, unit.kind !== 'van', rimColor, wheels);
  let total = length;
  if (unit.kind === 'tractor') {
    const fifth = box(1.1, 0.12, 1.4, mat('#3b4252'), 0.04);
    fifth.position.set(-length / 2 + 1.8, 1.15, 0);
    body.add(fifth);
    if (look.trailerModelId) {
      const tr = buildTrailer(look.trailerModelId, look.trailerColor ?? '#e5edf6', wheels);
      const kingpinX = -length / 2 + 1.8;
      tr.group.position.x = kingpinX - tr.length / 2 + 1.2;
      root.add(tr.group);
      total = length / 2 - (kingpinX - tr.length + 1.2);
    }
  }
  // Centre the combination on its own origin.
  const bbox = new THREE.Box3().setFromObject(root);
  const cx = (bbox.min.x + bbox.max.x) / 2;
  root.children.forEach((c) => (c.position.x -= cx));
  const eye = new THREE.Vector3(frontX - cabL * 0.55 - cx, 1.1 + lowerH + upperH * 0.35 + lift, -width * 0.22);
  return { group: root, length: total, wheels, parts, eye, cab: { frontX: frontX - cx, length: cabL, height: cabH + lift, width } };
}

function buildTrailer(trailerId: string, color: string, wheels: THREE.Object3D[]) {
  const t = trailerModel(trailerId);
  const g = new THREE.Group();
  const width = 2.55;
  const length = t.body === 'lowbed' ? 16 : 13.6;
  const deckY = t.body === 'lowbed' ? 0.95 : 1.35;
  const frame = box(length, 0.3, width * 0.9, mat('#2b3442', { roughness: 0.7 }), 0.03);
  frame.position.set(0, deckY, 0);
  g.add(frame);
  const paint = mat(color, { roughness: 0.55, metalness: 0.1 });
  const top = deckY + 0.15;
  if (['curtain', 'reefer', 'container', 'livestock'].includes(t.body)) {
    const h = 2.75;
    const b = box(length, h, width, t.body === 'reefer' ? mat('#f1f5f9', { roughness: 0.5 }) : paint, 0.1);
    b.position.set(0, top + h / 2, 0);
    g.add(b);
    if (t.body === 'reefer') {
      const unit = box(0.5, 1.6, 2.0, mat('#cbd5e1', { metalness: 0.4 }), 0.05);
      unit.position.set(length / 2 + 0.25, top + 1.6, 0);
      g.add(unit);
    }
  } else if (t.body === 'tanker') {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(1.15, length - 2.6, 8, 24), mat('#cbd5e1', { metalness: 0.8, roughness: 0.25 }));
    tank.rotation.z = Math.PI / 2;
    tank.position.set(0, top + 1.15, 0);
    tank.castShadow = true;
    g.add(tank);
  } else if (t.body === 'tipper') {
    const tub = box(length - 1.5, 1.7, width, paint, 0.12);
    tub.position.set(0.3, top + 0.85, 0);
    g.add(tub);
  } else {
    const deck = box(length, 0.12, width, mat('#6b4f32', { roughness: 0.9 }), 0.02);
    deck.position.set(0, top, 0);
    g.add(deck);
  }
  const axles = Math.max(2, t.axles ?? 3);
  for (let i = 0; i < axles; i++) axle(g, -length / 2 + 1.4 + i * 1.35, width, 0.5, true, RIM_COLORS.steel!, wheels);
  for (const side of [-1, 1]) {
    const leg = box(0.12, deckY - 0.2, 0.12, mat('#9ca3af'), 0.02);
    leg.position.set(length / 2 - 3.2, (deckY - 0.2) / 2 + 0.1, side * 0.9);
    g.add(leg);
  }
  return { group: g, length };
}

/** Frees the GPU memory of everything under `o`. */
export function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh || c instanceof THREE.Points || c instanceof THREE.Sprite) {
      c.geometry?.dispose();
      const ms = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of ms) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    }
  });
}
