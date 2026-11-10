import * as THREE from 'three';
import type { BusModelId } from '@/lib/game/buses';
import { at, box, cyl, emissive, M, mat, RIM_COLORS, wheel } from './truck3d';

/**
 * 1.3 „Автобусна компания“: the three buses in 3D, built in code like the trucks
 * (invented brands). The bus faces +x, its right side (doors) is +z; it stands
 * centred on the origin. Sizes follow European buses: a 7.5 m shuttle, a 12 m
 * intercity bus and a 13.8 m three-axle coach, 2.55 m wide.
 *
 * The body is the side profile (rounded corners, a raked front, real wheel
 * arches cut out) extruded across the width with rounded edges, so nothing runs
 * over the wheels; the skirt runs between the arches.
 */
interface Spec {
  length: number; width: number; height: number; axles: number[]; doors: number[]; rake: number;
  body: string; skirt: string; stripe: string; tyre: number; bays: boolean; rearWindow: boolean;
}
const SPEC: Record<BusModelId, Spec> = {
  // A minibus: a sloped nose, one door behind the front wheel.
  shuttle: { length: 7.4, width: 2.1, height: 2.65, axles: [-2.1, 2.3], doors: [1.25], rake: 0.62, body: '#f59e0b', skirt: '#7c2d12', stripe: '#fde68a', tyre: 0.36, bays: false, rearWindow: true },
  intercity: { length: 12, width: 2.55, height: 3.15, axles: [-2.6, 3.05], doors: [-0.3, 4.75], rake: 0.3, body: '#22d3ee', skirt: '#164e63', stripe: '#e0f2fe', tyre: 0.5, bays: true, rearWindow: true },
  coach: { length: 13.8, width: 2.55, height: 3.7, axles: [-4.3, -2.95, 4.1], doors: [0.2, 5.65], rake: 0.32, body: '#8b5cf6', skirt: '#3b0764', stripe: '#ede9fe', tyre: 0.52, bays: true, rearWindow: false },
};

const BEVEL = 0.07;

/** A notch for each wheel along the bottom edge y0 (left to right), as part of an outline. */
function arches(p: THREE.Path, axles: number[], cy: number, r: number, y0: number) {
  const a = Math.asin(Math.max(-1, Math.min(1, (y0 - cy) / r)));
  const dx = Math.sqrt(Math.max(0, r * r - (y0 - cy) ** 2));
  for (const ax of [...axles].sort((m, n) => m - n)) {
    p.lineTo(ax - dx, y0);
    p.absarc(ax, cy, r, Math.PI - a, a, true);
  }
}

function extrude(shape: THREE.Shape, depth: number, m: THREE.Material, bevel = 0) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 28 });
  geo.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildBus(model: BusModelId, color?: string | null): { group: THREE.Group; length: number } {
  const s = SPEC[model];
  const g = new THREE.Group();
  const L = s.length, W = s.width, H = s.height;
  const floor = s.tyre * 0.55;
  const bodyH = H - floor;
  const archR = s.tyre + 0.15;
  const paint = new THREE.MeshPhysicalMaterial({ color: color ?? s.body, metalness: 0.35, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.1 });
  const skirtM = mat(s.skirt, { roughness: 0.5, metalness: 0.3 });
  const tinted = new THREE.MeshPhysicalMaterial({ color: '#0b1622', metalness: 0.45, roughness: 0.06, clearcoat: 1 });
  const doorGlass = new THREE.MeshPhysicalMaterial({ color: '#1e3a52', metalness: 0.4, roughness: 0.08, clearcoat: 1 });
  const dark = mat('#0b0f16', { roughness: 0.6 });
  const rubber = mat('#111318', { roughness: 0.9 });
  const amber = emissive('#f59e0b', 0.9);
  const side = (z: number) => [-1, 1].map((k) => k * z);

  // The body: the side profile with arches, extruded with rounded edges.
  const x0 = -L / 2 + BEVEL, x1 = L / 2 - BEVEL, y0 = floor + BEVEL, y1 = H - BEVEL;
  const yA = floor + bodyH * 0.42; // where the windscreen starts
  const frontAt = (y: number) => x1 - s.rake * Math.max(0, (y - yA) / (y1 - yA));
  const outline = new THREE.Shape();
  outline.moveTo(x0 + 0.12, y0);
  arches(outline, s.axles, s.tyre, archR + BEVEL, y0);
  outline.lineTo(x1 - 0.14, y0);
  outline.quadraticCurveTo(x1, y0, x1, y0 + 0.14);
  outline.lineTo(x1, yA);
  outline.lineTo(x1 - s.rake * 0.9, y1 - 0.3);
  outline.quadraticCurveTo(x1 - s.rake, y1, x1 - s.rake - 0.45, y1);
  outline.lineTo(x0 + 0.35, y1);
  outline.quadraticCurveTo(x0, y1, x0, y1 - 0.35);
  outline.lineTo(x0, y0 + 0.12);
  outline.quadraticCurveTo(x0, y0, x0 + 0.12, y0);
  g.add(extrude(outline, W - 2 * BEVEL, paint, BEVEL));

  // Dark wheel wells behind the tyres and a lip around each arch.
  for (const ax of s.axles) {
    const well = new THREE.Shape();
    well.absarc(0, 0, archR, -0.35, Math.PI + 0.35, false);
    well.closePath();
    g.add(at(extrude(well, W - 0.7, dark), ax, s.tyre, 0));
    const lip = new THREE.Shape();
    lip.absarc(0, 0, archR + 0.07, 0.12, Math.PI - 0.12, false);
    lip.absarc(0, 0, archR, Math.PI - 0.12, 0.12, true);
    lip.closePath();
    for (const z of side(W / 2 + 0.01)) g.add(at(extrude(lip, 0.05, skirtM), ax, s.tyre, z));
  }
  // The skirt runs between the arches only (never across a wheel).
  const cuts = [-L / 2 + 0.1, ...[...s.axles].sort((m, n) => m - n).flatMap((ax) => [ax - archR - 0.04, ax + archR + 0.04]), L / 2 - 0.1];
  for (let i = 0; i < cuts.length; i += 2) {
    const a = cuts[i]!, b = cuts[i + 1]!;
    if (b - a > 0.05) g.add(at(box(b - a, 0.4, W + 0.03, skirtM, 0.05), (a + b) / 2, floor + 0.16, 0));
  }

  // Roof: an air-conditioning unit with vents, escape hatches, a second unit on the long buses.
  g.add(at(box(L * 0.3, 0.24, W * 0.62, M.alu(), 0.1), -L * 0.08, H + 0.1, 0));
  for (let i = 0; i < 4; i++) g.add(at(box(L * 0.3 * 0.18, 0.02, W * 0.5, dark, 0.01), -L * 0.08 - L * 0.11 + i * L * 0.075, H + 0.23, 0));
  for (const hx of [L * 0.18, -L * 0.33]) g.add(at(box(0.7, 0.06, 0.7, mat('#cbd5e1', { roughness: 0.4 }), 0.05), hx, H + 0.02, 0));
  if (s.bays) g.add(at(box(L * 0.14, 0.18, W * 0.5, M.alu(), 0.08), L * 0.3, H + 0.08, 0));

  // Side windows: a black band with tinted panes, then the livery stripe and a chrome line.
  const winY = floor + bodyH * 0.66, winH = bodyH * (model === 'coach' ? 0.36 : 0.33);
  const winFrom = -L / 2 + 0.4, winTo = frontAt(winY) - 0.45;
  const panes = Math.max(3, Math.round((winTo - winFrom) / 1.3));
  const paneW = (winTo - winFrom) / panes;
  const stripeM = mat(s.stripe, { roughness: 0.35, metalness: 0.2 });
  for (const z of side(W / 2)) {
    const k = Math.sign(z);
    g.add(at(box(winTo - winFrom + 0.12, winH + 0.12, 0.03, dark, 0.05), (winFrom + winTo) / 2, winY, z + k * 0.004));
    for (let i = 0; i < panes; i++) g.add(at(box(paneW - 0.09, winH, 0.03, tinted, 0.06), winFrom + (i + 0.5) * paneW, winY, z + k * 0.014));
    g.add(at(box(L - 0.5, 0.16, 0.03, stripeM, 0.03), -0.1, winY - winH / 2 - 0.3, z + k * 0.008));
    g.add(at(box(L - 0.6, 0.035, 0.03, M.chrome(), 0.01), -0.1, winY - winH / 2 - 0.13, z + k * 0.01));
    // Amber side markers along the skirt.
    for (let x = -L / 2 + 0.6; x < L / 2 - 0.4; x += 2.4) {
      if (s.axles.some((ax) => Math.abs(ax - x) < archR + 0.15)) continue;
      g.add(at(box(0.12, 0.05, 0.02, amber, 0.01), x, floor + 0.22, z + k * 0.025));
    }
    // An indicator repeater behind the front wheel.
    g.add(at(box(0.14, 0.06, 0.02, amber, 0.01), s.axles[s.axles.length - 1]! - archR - 0.3, floor + 0.55, z + k * 0.01));
  }

  // Luggage bays between the axles (intercity and coach): flap seams and handles.
  if (s.bays) {
    const from = s.axles[s.axles.length - 2]! + archR + 0.15, to = s.axles[s.axles.length - 1]! - archR - 0.15;
    const top = winY - winH / 2 - 0.45, bottom = floor + 0.42;
    const flaps = Math.max(2, Math.round((to - from) / 1.6));
    for (const z of side(W / 2 + 0.008)) {
      g.add(at(box(to - from, 0.025, 0.02, dark, 0.01), (from + to) / 2, top, z));
      for (let i = 0; i <= flaps; i++) g.add(at(box(0.025, top - bottom, 0.02, dark, 0.01), from + ((to - from) * i) / flaps, (top + bottom) / 2, z));
      for (let i = 0; i < flaps; i++) g.add(at(box(0.22, 0.05, 0.03, M.chrome(), 0.02), from + ((to - from) * (i + 0.5)) / flaps, bottom + 0.15, z));
    }
  }

  // Doors on the right side (+z, as on the continent): two glass leaves, rubber seals, a step.
  for (const dx of s.doors) {
    const dTop = winY + winH / 2, dBottom = floor + 0.06;
    const dh = dTop - dBottom, dz = W / 2 + 0.015;
    g.add(at(box(1.12, dh + 0.06, 0.03, dark, 0.04), dx, dBottom + dh / 2, dz));
    for (const off of [-0.275, 0.275]) {
      g.add(at(box(0.5, dh - 0.1, 0.03, doorGlass, 0.04), dx + off, dBottom + dh / 2, dz + 0.012));
      g.add(at(box(0.03, dh * 0.55, 0.04, M.steel(), 0.01), dx + off * 0.5, dBottom + dh * 0.5, dz + 0.03));
    }
    g.add(at(box(0.03, dh, 0.04, rubber, 0.01), dx, dBottom + dh / 2, dz + 0.02));
    g.add(at(box(1.0, 0.04, 0.2, M.alu(), 0.02), dx, floor - 0.03, W / 2 - 0.05));
  }

  // The front: the raked windscreen with the LED destination sign and wipers.
  const segH = y1 - 0.3 - yA, segX = s.rake * 0.9;
  const segLen = Math.hypot(segH, segX);
  const tilt = Math.atan2(segX, segH);
  const screen = new THREE.Group();
  screen.add(box(0.03, segLen - 0.08, W - 0.22, tinted, 0.06));
  screen.add(at(box(0.035, 0.32, W * 0.78, dark, 0.03), 0.005, segLen / 2 - 0.24, 0));
  screen.add(at(box(0.04, 0.2, W * 0.7, emissive('#fbbf24', 1.1), 0.02), 0.01, segLen / 2 - 0.24, 0));
  for (const z of [-0.35, 0.45]) {
    const wiper = at(box(0.025, 0.025, W * 0.36, dark, 0.008), 0.03, -segLen / 2 + 0.3, z * W * 0.5);
    wiper.rotation.x = 0.45;
    screen.add(wiper);
  }
  screen.rotation.z = tilt;
  const nx = Math.cos(tilt) * (BEVEL + 0.012), ny = Math.sin(tilt) * (BEVEL + 0.012);
  g.add(at(screen, x1 - segX / 2 + nx, yA + segH / 2 + ny, 0));

  // Lower front: grille, headlight clusters, fog lights, bumper, plate, badge.
  const fx = L / 2 + 0.005;
  g.add(at(box(0.04, 0.3, W * 0.48, dark, 0.04), fx, floor + 0.62, 0));
  for (let i = 0; i < 4; i++) g.add(at(box(0.045, 0.025, W * 0.44, M.chrome(), 0.01), fx + 0.005, floor + 0.52 + i * 0.07, 0));
  for (const z of side(W / 2 - 0.36)) {
    g.add(at(box(0.04, 0.22, 0.5, dark, 0.05), fx, floor + 0.66, z));
    for (const dz of [-0.12, 0.12]) g.add(at(cyl(0.075, 0.075, 0.03, emissive('#fff7d6', 1.3), 16), fx + 0.02, floor + 0.66, z + dz).rotateZ(Math.PI / 2));
    g.add(at(box(0.04, 0.05, 0.3, amber, 0.02), fx + 0.01, floor + 0.52, z));
    g.add(at(cyl(0.05, 0.05, 0.03, emissive('#fffbeb', 0.8), 12), fx + 0.12, floor + 0.2, z).rotateZ(Math.PI / 2));
  }
  g.add(at(box(0.16, 0.3, W - 0.04, skirtM, 0.08), L / 2 + 0.04, floor + 0.15, 0));
  g.add(at(box(0.03, 0.12, 0.52, mat('#f8fafc'), 0.02), L / 2 + 0.13, floor + 0.2, 0));
  g.add(at(box(0.03, 0.1, 0.36, M.chrome(), 0.03), fx + 0.01, yA - 0.12, 0));

  // Rear-view mirrors on curved arms („ears“), typical of buses.
  const mirrorY = floor + bodyH * 0.86;
  for (const k of [-1, 1]) {
    // The arm runs from the front corner forward and out; the mirror hangs from its end.
    const sx = frontAt(mirrorY) - 0.05, sz = k * (W / 2 - 0.05);
    const ex = sx + 0.42, ez = k * (W / 2 + 0.22);
    const dx = ex - sx, dz = ez - sz, armLen = Math.hypot(dx, dz);
    const arm = box(armLen, 0.04, 0.04, M.steel(), 0.015);
    arm.rotation.y = Math.atan2(-dz, dx);
    g.add(at(arm, (sx + ex) / 2, mirrorY, (sz + ez) / 2));
    g.add(at(box(0.03, 0.1, 0.03, M.steel(), 0.01), ex, mirrorY - 0.05, ez));
    g.add(at(box(0.08, 0.38, 0.2, dark, 0.04), ex, mirrorY - 0.28, ez));
  }

  // The back: rear window (not on the coach — the engine is there), engine grille, lights, plate, bumper.
  const bx = -L / 2 - 0.005;
  if (s.rearWindow) g.add(at(box(0.03, bodyH * 0.28, W - 0.45, tinted, 0.06), bx, floor + bodyH * 0.7, 0));
  if (model !== 'shuttle') {
    g.add(at(box(0.03, 0.55, W * 0.6, dark, 0.04), bx, floor + bodyH * 0.38, 0));
    for (let i = 0; i < 6; i++) g.add(at(box(0.035, 0.03, W * 0.56, M.alu(), 0.01), bx - 0.005, floor + bodyH * 0.38 - 0.22 + i * 0.088, 0));
  }
  for (const z of side(W / 2 - 0.2)) {
    g.add(at(box(0.04, 0.5, 0.2, emissive('#ef4444', 0.85), 0.05), bx, floor + 0.78, z));
    g.add(at(box(0.04, 0.12, 0.2, amber, 0.03), bx, floor + 0.45, z));
  }
  g.add(at(box(0.16, 0.28, W - 0.04, skirtM, 0.08), -L / 2 - 0.04, floor + 0.14, 0));
  // The livery stripe wraps round the back, with a chrome badge above it.
  g.add(at(box(0.03, 0.16, W - 0.3, stripeM, 0.03), bx - 0.004, winY - winH / 2 - 0.3, 0));
  g.add(at(box(0.03, 0.1, 0.5, M.chrome(), 0.03), bx - 0.006, winY - winH / 2 - 0.05, 0));
  g.add(at(box(0.03, 0.12, 0.52, mat('#f8fafc'), 0.02), -L / 2 - 0.13, floor + 0.2, 0));

  // Wheels, with mud flaps behind the rearmost axle.
  for (const ax of s.axles) {
    for (const z of side(W / 2 - 0.16)) g.add(at(wheel(s.tyre, 0.3, RIM_COLORS.alloy!, Math.sign(z)), ax, s.tyre, z));
  }
  const last = Math.min(...s.axles);
  for (const z of side(W / 2 - 0.16)) g.add(at(box(0.03, s.tyre * 0.9, 0.32, rubber, 0.01), last - archR - 0.05, s.tyre * 0.55, z));
  return { group: g, length: L };
}
