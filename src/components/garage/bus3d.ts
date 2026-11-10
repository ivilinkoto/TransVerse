import * as THREE from 'three';
import type { BusModelId } from '@/lib/game/buses';
import { at, box, cyl, emissive, M, mat, RIM_COLORS, wheel } from './truck3d';

/**
 * 1.3 „Автобусна компания“: the three buses in 3D, built in code like the trucks
 * (invented brands). The bus faces +x, its right side (doors) is +z; it stands
 * centred on the origin. Sizes follow European buses: a 7.5 m shuttle, a 12 m
 * intercity bus and a 13.8 m three-axle coach, 2.55 m wide.
 */
const SPEC: Record<BusModelId, { length: number; width: number; height: number; axles: number[]; doors: number[]; body: string; skirt: string; stripe: string; tyre: number }> = {
  shuttle: { length: 7.4, width: 2.1, height: 2.65, axles: [2.45, -2.1], doors: [2.75], body: '#f59e0b', skirt: '#92400e', stripe: '#fde68a', tyre: 0.36 },
  intercity: { length: 12, width: 2.55, height: 3.15, axles: [3.4, -2.6], doors: [4.6, -0.3], body: '#22d3ee', skirt: '#0e7490', stripe: '#e0f2fe', tyre: 0.5 },
  coach: { length: 13.8, width: 2.55, height: 3.7, axles: [4.4, -2.9, -4.3], doors: [5.6, 0.2], body: '#8b5cf6', skirt: '#4c1d95', stripe: '#ede9fe', tyre: 0.52 },
};

export function buildBus(model: BusModelId, color?: string | null): { group: THREE.Group; length: number } {
  const s = SPEC[model];
  const g = new THREE.Group();
  const L = s.length, W = s.width, H = s.height;
  const floor = s.tyre * 0.55;
  const paint = new THREE.MeshPhysicalMaterial({ color: color ?? s.body, metalness: 0.35, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.1 });
  const skirtM = mat(s.skirt, { roughness: 0.5, metalness: 0.3 });
  const glass = M.glass();
  const dark = mat('#0b0f16', { roughness: 0.6 });

  // The body: a rounded shell, a darker skirt below, a slightly narrower roof with a sheen.
  const bodyH = H - floor;
  g.add(at(box(L, bodyH, W, paint, 0.32), 0, floor + bodyH / 2, 0));
  g.add(at(box(L - 0.1, 0.42, W + 0.02, skirtM, 0.12), 0, floor + 0.24, 0));
  g.add(at(box(L * 0.32, 0.22, W * 0.6, M.alu(), 0.08), -L * 0.08, H + 0.1, 0));
  if (model === 'coach') g.add(at(box(L * 0.18, 0.18, W * 0.5, M.alu(), 0.06), L * 0.22, H + 0.08, 0));

  // Side windows as one dark band on each side, with painted pillars between panes.
  const winY = floor + bodyH * 0.66, winH = bodyH * (model === 'coach' ? 0.36 : 0.34);
  const winFrom = -L / 2 + 0.45, winTo = L / 2 - 1.2;
  for (const side of [-1, 1]) {
    g.add(at(box(winTo - winFrom, winH, 0.04, glass, 0.03), (winFrom + winTo) / 2, winY, side * (W / 2 + 0.005)));
    const panes = Math.round((winTo - winFrom) / 1.25);
    for (let i = 1; i < panes; i++) g.add(at(box(0.08, winH + 0.02, 0.05, paint, 0.02), winFrom + ((winTo - winFrom) * i) / panes, winY, side * (W / 2 + 0.01)));
    // The livery stripe under the windows and a thin chrome line.
    g.add(at(box(L - 0.5, 0.16, 0.03, mat(s.stripe, { roughness: 0.35, metalness: 0.2 }), 0.03), 0, winY - winH / 2 - 0.25, side * (W / 2 + 0.01)));
    g.add(at(box(L - 0.6, 0.03, 0.03, M.chrome(), 0.01), 0, winY - winH / 2 - 0.1, side * (W / 2 + 0.012)));
  }

  // Doors on the right side (+z, as on the continent): glass leaves in a dark frame.
  for (const dx of s.doors) {
    const dh = bodyH - 0.45;
    g.add(at(box(1.1, dh, 0.05, dark, 0.04), dx, floor + 0.2 + dh / 2, W / 2 + 0.015));
    for (const off of [-0.27, 0.27]) g.add(at(box(0.5, dh - 0.12, 0.04, glass, 0.03), dx + off, floor + 0.2 + dh / 2, W / 2 + 0.03));
  }

  // The front: a big raked windscreen, a destination sign, headlights, a bumper and the badge.
  const front = L / 2;
  const ws = box(0.06, bodyH * 0.5, W - 0.16, glass, 0.04);
  ws.rotation.z = -0.12;
  g.add(at(ws, front + 0.02, floor + bodyH * 0.62, 0));
  g.add(at(box(0.05, 0.22, W * 0.7, emissive('#fbbf24', 0.9), 0.03), front + 0.03, floor + bodyH * 0.93, 0));
  g.add(at(box(0.12, 0.34, W - 0.1, skirtM, 0.08), front - 0.02, floor + 0.32, 0));
  for (const side of [-1, 1]) {
    g.add(at(box(0.06, 0.12, 0.42, emissive('#fff7d6', 1.2), 0.04), front + 0.02, floor + 0.62, side * (W / 2 - 0.35)));
    // Rear-view mirrors on curved arms („ears“), typical of buses.
    const arm = cyl(0.025, 0.025, 0.55, M.steel(), 8);
    arm.rotation.x = Math.PI / 2;
    arm.rotation.z = 0.5;
    g.add(at(arm, front + 0.18, floor + bodyH * 0.86, side * (W / 2 - 0.05)));
    g.add(at(box(0.08, 0.38, 0.2, dark, 0.04), front + 0.38, floor + bodyH * 0.74, side * (W / 2 + 0.12)));
  }
  g.add(at(box(0.04, 0.12, 0.5, M.chrome(), 0.03), front + 0.04, floor + 0.85, 0));

  // The back: rear window (not on the coach — engine there), lights, a ladder on the coach.
  const back = -L / 2;
  if (model !== 'coach') g.add(at(box(0.04, bodyH * 0.3, W - 0.4, glass, 0.03), back - 0.01, floor + bodyH * 0.68, 0));
  for (const side of [-1, 1]) g.add(at(box(0.05, 0.42, 0.18, emissive('#ef4444', 0.8), 0.04), back - 0.02, floor + 0.7, side * (W / 2 - 0.2)));
  g.add(at(box(0.05, 0.22, 0.52, mat('#f8fafc'), 0.02), back - 0.02, floor + 0.45, 0));

  // Wheels in dark arches.
  for (const ax of s.axles) {
    for (const side of [-1, 1]) {
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(s.tyre + 0.1, s.tyre + 0.1, 0.06, 32, 1, false, 0, Math.PI), dark);
      arch.rotation.x = Math.PI / 2;
      arch.rotation.y = Math.PI / 2;
      g.add(at(arch, ax, s.tyre, side * (W / 2 + 0.005)));
      const w = wheel(s.tyre, 0.3, RIM_COLORS.alloy!, side);
      g.add(at(w, ax, s.tyre, side * (W / 2 - 0.16)));
    }
  }
  return { group: g, length: L };
}
