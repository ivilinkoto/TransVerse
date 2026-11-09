/**
 * 1.2.3.6: a company depot in 3D — a fenced yard with an office, a hall and as many
 * parking bays as the depot has places; the player's free trucks in the city stand
 * in them. 1 unit = 1 m, the yard's front (the gate) faces +z.
 */
import * as THREE from 'three';
import { asphaltTexture, corrugatedNormal, groundTexture, textTexture } from './textures';
import { box, buildTruck, mat, type TruckLook } from './truck3d';

export interface DepotLook {
  slots: number;
  city: string;
  company: string;
  trucks: TruckLook[];
}

const BAY_W = 4.6;
const BAY_D = 19;

const place = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => {
  o.position.set(x, y, z);
  return o;
};

/** Builds the yard into `world` and returns its size (for the camera). */
export function buildDepot(world: THREE.Group, look: DepotLook): { width: number; depth: number } {
  const slots = Math.max(1, Math.min(look.slots, 24));
  const perRow = Math.min(slots, 8);
  const rows = Math.ceil(slots / perRow);
  const bayRun = perRow * BAY_W;
  const width = Math.max(44, bayRun + 30);
  const depth = 20 + rows * (BAY_D + 6);
  const left = -width / 2;
  const back = -depth / 2;

  // Ground: grass around, asphalt yard inside the fence.
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: groundTexture('grass'), roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  world.add(grass);
  // The textures are shared (cached): a copy gets this yard's own repeat.
  const tex = asphaltTexture().clone();
  tex.repeat.set(width / 8, depth / 8);
  tex.needsUpdate = true;
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
  yard.rotation.x = -Math.PI / 2;
  yard.position.y = 0.01;
  yard.receiveShadow = true;
  world.add(yard);

  // Parking bays: white lines and a number on the asphalt.
  const white = new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.7 });
  const bayX0 = left + 6;
  for (let r = 0; r < rows; r++) {
    const z0 = back + 4 + r * (BAY_D + 6);
    const inRow = Math.min(perRow, slots - r * perRow);
    for (let i = 0; i <= inRow; i++) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.15, BAY_D), white);
      line.rotation.x = -Math.PI / 2;
      world.add(place(line, bayX0 + i * BAY_W, 0.02, z0 + BAY_D / 2));
    }
    for (let i = 0; i < inRow; i++) {
      const n = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshStandardMaterial({ map: textTexture(String(r * perRow + i + 1), '#e5e7eb'), transparent: true }));
      n.rotation.x = -Math.PI / 2;
      world.add(place(n, bayX0 + i * BAY_W + BAY_W / 2, 0.025, z0 + BAY_D - 1));
      // Wheel stop at the back of the bay.
      world.add(place(box(2.4, 0.15, 0.3, mat('#facc15', { roughness: 0.8 }), 0.03), bayX0 + i * BAY_W + BAY_W / 2, 0.08, z0 + 0.4));
    }
  }

  // The trucks in the bays, cab towards the gate.
  look.trucks.slice(0, slots).forEach((t, k) => {
    const r = Math.floor(k / perRow);
    const i = k % perRow;
    const built = buildTruck(t);
    const g = new THREE.Group();
    g.add(built.group);
    g.rotation.y = -Math.PI / 2;
    const z0 = back + 4 + r * (BAY_D + 6);
    // After the turn the truck's +x (its front) points to +z.
    const centre = built.cab.frontX - built.length / 2;
    g.position.set(bayX0 + i * BAY_W + BAY_W / 2, 0.16, z0 + BAY_D / 2 - centre - (BAY_D - built.length) / 2 + 1.2);
    world.add(g);
  });

  // Office (two floors with a band of windows) by the gate, the hall on the far side.
  const right = left + width;
  const office = new THREE.Group();
  const wall = mat('#e2e8f0', { roughness: 0.8, metalness: 0 });
  office.add(place(box(12, 7, 8, wall, 0.05), 0, 3.5, 0));
  const glass = new THREE.MeshPhysicalMaterial({ color: '#1e3a5f', roughness: 0.08, metalness: 0.3, clearcoat: 1 });
  for (const y of [2, 5.2]) office.add(place(box(10.6, 1.4, 0.1, glass, 0.01), 0, y, 4.02));
  office.add(place(box(2, 2.4, 0.12, mat('#334155'), 0.02), -4, 1.2, 4.05));
  office.add(place(box(12.4, 0.3, 8.4, mat('#475569'), 0.03), 0, 7.1, 0));
  // The sign on the roof: the company; the city by the gate.
  const signTex = textTexture(look.company, '#f8fafc', '#1d4ed8');
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.6), new THREE.MeshStandardMaterial({ map: signTex, emissive: '#1e3a8a', emissiveIntensity: 0.3 }));
  office.add(place(sign, 0, 8.3, 0.2));
  office.add(place(box(11.4, 1.8, 0.2, mat('#0f172a'), 0.03), 0, 8.3, 0.05));
  world.add(place(office, right - 10, 0, -depth / 2 + depth - 12));

  const clad = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.5, metalness: 0.5, normalMap: corrugatedNormal(30).clone() });
  clad.normalMap!.wrapS = THREE.RepeatWrapping;
  clad.normalMap!.repeat.set(6, 1);
  clad.normalMap!.needsUpdate = true;
  const hallW = 16;
  const hallD = Math.min(depth - 18, 26);
  const hall = place(new THREE.Group(), right - 10, 0, back + 2 + hallD / 2);
  hall.add(place(box(hallW, 9, hallD, clad, 0.05), 0, 4.5, 0));
  hall.add(place(box(hallW + 0.6, 0.4, hallD + 0.6, mat('#334155'), 0.03), 0, 9.1, 0));
  // Two roller doors to the yard and a strip of skylights on the front.
  for (const z of [-hallD / 4, hallD / 4]) hall.add(place(box(0.15, 5, 5, mat('#e5e7eb', { metalness: 0.4 }), 0.02), -hallW / 2 - 0.05, 2.5, z));
  hall.add(place(box(4.5, 4.5, 0.15, mat('#e5e7eb', { metalness: 0.4 }), 0.02), 0, 2.25, hallD / 2 + 0.05));
  hall.add(place(box(hallW - 2, 0.8, 0.1, glass, 0.01), 0, 7.6, hallD / 2 + 0.05));
  world.add(hall);

  // Fence with a gate gap at the front, and light poles.
  const post = mat('#9ca3af', { metalness: 0.7, roughness: 0.4 });
  const mesh = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.6, roughness: 0.5, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const fence = (x1: number, z1: number, x2: number, z2: number) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 2), mesh);
    panel.position.set((x1 + x2) / 2, 1.1, (z1 + z2) / 2);
    panel.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    world.add(panel);
    for (let s = 0; s <= len; s += 3) world.add(place(box(0.1, 2.2, 0.1, post, 0.01), x1 + ((x2 - x1) * s) / len, 1.1, z1 + ((z2 - z1) * s) / len));
  };
  const front = back + depth;
  fence(left, back, right, back);
  fence(left, back, left, front);
  fence(right, back, right, front);
  fence(left, front, -6, front);
  fence(6, front, right, front);
  for (const x of [-6, 6]) world.add(place(box(0.4, 2.6, 0.4, mat('#facc15'), 0.03), x, 1.3, front));
  const citySign = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.8), new THREE.MeshStandardMaterial({ map: textTexture(look.city, '#0b0f17', '#f8fafc') }));
  world.add(place(citySign, 9.5, 2.2, front + 0.08));
  world.add(place(box(5.2, 1, 0.1, mat('#334155'), 0.02), 9.5, 2.2, front));
  for (const x of [7.2, 11.8]) world.add(place(box(0.12, 2.2, 0.12, post, 0.01), x, 1.1, front));
  // The barrier arm across the gate, red and white.
  for (let k = 0; k < 6; k++) world.add(place(box(1.85, 0.14, 0.14, mat(k % 2 ? '#f8fafc' : '#ef4444'), 0.02), -5.1 + k * 1.85, 1.1, front));
  for (const [x, z] of [[left + 2, back + 2], [right - 2, back + 2], [left + 2, front - 2], [right - 2, front - 2]] as const) {
    world.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 10, 10), post), x, 5, z));
    const lamp = place(box(1.2, 0.25, 0.5, mat('#f8fafc', { emissive: '#fef3c7', emissiveIntensity: 0.8 }), 0.02), x, 10, z);
    world.add(lamp);
  }
  return { width, depth };
}
