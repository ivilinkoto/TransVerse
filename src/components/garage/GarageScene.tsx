'use client';

/**
 * 1.2.3.5 „Гараж“: the player's hall in 3D — a turntable with the chosen truck, the
 * other trucks on side platforms, tyre shelves, a tool wall, a trophy cabinet, the
 * retro shelf, a neon sign, real-time day and night; the cab from the inside, a test
 * drive on the yard and photo scenes. The hall grows with the player's level.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Tuning } from '@/lib/game/garage';
import { box, buildTruck, disposeTree, mat, type BuiltTruck, type TruckLook } from './truck3d';

export type GarageMode = 'orbit' | 'cab' | 'drive';
export type GarageScenery = 'hall' | 'snow' | 'sunset' | 'highway';

export interface GarageSceneProps {
  truck: TruckLook;
  others?: TruckLook[];
  tier: number;
  night: boolean;
  sign: string;
  trophies: number;
  retired?: { modelId: string; color: string }[];
  charms?: string[];
  mode: GarageMode;
  scenery: GarageScenery;
  spin: boolean;
  /** Hands the parent a function that returns the current frame as a PNG data URL. */
  onCapture?: (capture: (() => string) | null) => void;
}

const HALLS: Record<number, { w: number; d: number; h: number }> = { 1: { w: 30, d: 24, h: 8 }, 2: { w: 38, d: 28, h: 10 }, 3: { w: 48, d: 32, h: 12 } };

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  world: THREE.Group;
  holder: THREE.Group;
  truck: BuiltTruck | null;
  interior: THREE.Group | null;
  snow: THREE.Points | null;
  drops: { obj: THREE.Object3D; y: number; start: number }[];
  drive: { angle: number; radius: number } | null;
  mode: GarageMode;
}

function neonSign(text: string, night: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.font = 'bold 110px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#22d3ee';
  g.shadowBlur = night ? 40 : 18;
  g.fillStyle = '#a5f3fc';
  g.fillText(text.slice(0, 18).toUpperCase(), canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), m);
  return mesh;
}

function tyre(r = 0.5) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.28, 10, 24), mat('#111318', { roughness: 0.9 }));
  t.castShadow = true;
  return t;
}

/** The hall: floor, walls, windows, lights and everything on the walls. */
function buildHall(world: THREE.Group, scene: THREE.Scene, p: { tier: number; night: boolean; sign: string; trophies: number; retired: { modelId: string; color: string }[] }) {
  const { w, d, h } = HALLS[p.tier] ?? HALLS[1]!;
  scene.background = new THREE.Color(p.night ? '#05070d' : '#0f172a');
  scene.fog = null;
  // Polished concrete floor with painted bays.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: p.night ? '#1e2430' : '#5b6573', roughness: 0.22, metalness: 0.25 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  world.add(floor);
  for (let i = -3; i <= 3; i++) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, d * 0.8), new THREE.MeshBasicMaterial({ color: '#facc15', transparent: true, opacity: 0.35 }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(i * (w / 7), 0.005, 0);
    if (Math.abs(i) >= 2) world.add(line);
  }
  // Walls face inward (invisible from outside, so the camera can go round the truck).
  const wallMat = new THREE.MeshStandardMaterial({ color: p.tier === 3 ? '#1f2937' : '#334155', roughness: 0.85 });
  const walls: [number, number, number, number, number][] = [
    [w, h, 0, -d / 2, 0],
    [w, h, 0, d / 2, Math.PI],
    [d, h, -w / 2, 0, Math.PI / 2],
    [d, h, w / 2, 0, -Math.PI / 2],
  ];
  for (const [ww, hh, x, z, ry] of walls) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh), wallMat);
    wall.position.set(x, hh / 2, z);
    wall.rotation.y = ry;
    wall.receiveShadow = true;
    world.add(wall);
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: '#111827', roughness: 1 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = h;
  world.add(ceiling);
  // Windows high on the side walls: daylight or the night sky.
  const winMat = new THREE.MeshStandardMaterial({ color: p.night ? '#0b1730' : '#bfe3ff', emissive: new THREE.Color(p.night ? '#0b1730' : '#bfe3ff'), emissiveIntensity: p.night ? 0.3 : 1.1 });
  for (const side of [-1, 1]) {
    for (let i = -2; i <= 2; i++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(d / 7, 1.6), winMat);
      win.position.set(side * (w / 2 - 0.02), h - 1.6, i * (d / 6));
      win.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      world.add(win);
    }
  }
  // Roller door on the back wall.
  const door = box(8, 5.5, 0.1, mat('#475569', { metalness: 0.5, roughness: 0.5 }), 0.02);
  door.position.set(-w / 4, 2.75, -d / 2 + 0.06);
  world.add(door);
  for (let i = 0; i < 10; i++) {
    const rib = box(8, 0.04, 0.12, mat('#334155'), 0.01);
    rib.position.set(-w / 4, 0.4 + i * 0.55, -d / 2 + 0.08);
    world.add(rib);
  }
  // Neon sign with the player's name.
  const sign = neonSign(p.sign, p.night);
  sign.position.set(w / 6, h - 2.6, -d / 2 + 0.05);
  world.add(sign);
  // Tool wall (pegboard and tools).
  const peg = box(6, 3, 0.08, mat('#78716c', { roughness: 0.9 }), 0.02);
  peg.position.set(w / 6, 2.6, -d / 2 + 0.06);
  world.add(peg);
  for (let i = 0; i < 9; i++) {
    const tool = box(0.08, 0.5 + (i % 3) * 0.25, 0.06, mat(i % 2 ? '#dc2626' : '#cbd5e1', { metalness: 0.6 }), 0.02);
    tool.position.set(w / 6 - 2.5 + i * 0.62, 2.6 + (i % 2) * 0.3, -d / 2 + 0.14);
    tool.rotation.z = (i % 3 - 1) * 0.3;
    world.add(tool);
  }
  const bench = box(5, 0.9, 1, mat('#7f1d1d', { roughness: 0.6 }), 0.05);
  bench.position.set(w / 6, 0.45, -d / 2 + 0.7);
  world.add(bench);
  // Tyre shelves on the left wall.
  for (let level = 0; level < 3; level++) {
    const shelf = box(0.8, 0.06, 6, mat('#64748b', { metalness: 0.5 }), 0.01);
    shelf.position.set(-w / 2 + 0.5, 0.3 + level * 1.4, -d / 4);
    world.add(shelf);
    for (let i = 0; i < 5; i++) {
      const t = tyre(0.55);
      t.rotation.y = Math.PI / 2;
      t.position.set(-w / 2 + 0.5, 0.3 + level * 1.4 + 0.58, -d / 4 - 2.4 + i * 1.2);
      world.add(t);
    }
  }
  // Trophy cabinet with the player's badges as cups.
  const cabinet = box(4, 2.6, 0.9, new THREE.MeshPhysicalMaterial({ color: '#bae6fd', transmission: 0.6, roughness: 0.05, transparent: true, opacity: 0.35 }), 0.04);
  cabinet.position.set(w / 2 - 0.6, 1.3, d / 6);
  cabinet.rotation.y = -Math.PI / 2;
  world.add(cabinet);
  const gold = mat('#eab308', { metalness: 0.9, roughness: 0.2 });
  const cups = Math.min(12, p.trophies);
  for (let i = 0; i < cups; i++) {
    const cup = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 12), gold);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), gold);
    stem.position.y = 0.12;
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    bowl.rotation.x = Math.PI;
    bowl.position.y = 0.34;
    cup.add(base, stem, bowl);
    cup.position.set(w / 2 - 0.6, 0.45 + Math.floor(i / 6) * 1.05, d / 6 - 1.6 + (i % 6) * 0.62);
    world.add(cup);
  }
  // Retro shelf: the player's old trucks as small models.
  if (p.retired.length) {
    const shelf = box(0.7, 0.06, 6.5, mat('#92400e', { roughness: 0.8 }), 0.01);
    shelf.position.set(w / 2 - 0.45, 3.4, -d / 4);
    world.add(shelf);
    p.retired.slice(0, 8).forEach((r, i) => {
      const mini = buildTruck({ modelId: r.modelId, color: r.color, condition: 100 });
      mini.group.scale.setScalar(0.08);
      mini.group.rotation.y = -Math.PI / 2;
      mini.group.position.set(w / 2 - 0.45, 3.44, -d / 4 - 2.8 + i * 0.8);
      world.add(mini.group);
    });
  }
  // A car lift in the big hall; LED strips in the modern one.
  if (p.tier >= 2) {
    for (const z of [-1.6, 1.6]) {
      const post = box(0.35, 4, 0.35, mat('#dc2626', { metalness: 0.4 }), 0.04);
      post.position.set(-w / 2 + 4, 2, d / 4 + z);
      world.add(post);
    }
    const arm = box(2.5, 0.2, 3.6, mat('#374151', { metalness: 0.6 }), 0.03);
    arm.position.set(-w / 2 + 4, 1.4, d / 4);
    world.add(arm);
  }
  if (p.tier >= 3) {
    const led = new THREE.MeshBasicMaterial({ color: '#22d3ee' });
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, d * 0.9), led);
      strip.position.set(side * (w / 2 - 0.1), h - 0.4, 0);
      world.add(strip);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.08, 0.06), led);
    back.position.set(0, h - 0.4, -d / 2 + 0.1);
    world.add(back);
  }
  // Turntable with an LED ring.
  const table = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 0.16, 64), new THREE.MeshStandardMaterial({ color: '#1f2937', metalness: 0.7, roughness: 0.3 }));
  table.position.y = 0.08;
  table.receiveShadow = true;
  world.add(table);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.06, 8, 96), new THREE.MeshBasicMaterial({ color: '#22d3ee' }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.16;
  world.add(ring);
  // Lights: soft fill, a sun through the windows (or the night), spotlights from the ceiling.
  world.add(new THREE.HemisphereLight(p.night ? '#3b4a6b' : '#e2e8f0', '#1f2937', p.night ? 0.45 : 0.9));
  const key = new THREE.DirectionalLight(p.night ? '#a5b4fc' : '#fff4e0', p.night ? 0.5 : 1.6);
  key.position.set(8, h + 6, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, far: 60 });
  world.add(key);
  const spots = 2 + p.tier * 2;
  for (let i = 0; i < spots; i++) {
    const a = (i / spots) * Math.PI * 2;
    const spot = new THREE.SpotLight(p.night ? '#ffe2b0' : '#ffffff', p.night ? 120 : 70, h * 2.2, 0.5, 0.6, 1.6);
    spot.position.set(Math.cos(a) * 8, h - 0.3, Math.sin(a) * 6);
    spot.target.position.set(0, 1, 0);
    world.add(spot, spot.target);
    const fixture = box(0.5, 0.25, 0.5, mat('#0f172a', { emissive: new THREE.Color('#fef3c7'), emissiveIntensity: 0.6 }), 0.05);
    fixture.position.copy(spot.position);
    world.add(fixture);
  }
  return { w, d, h };
}

/** Outdoor scenes for photos and the test drive. */
function buildOutdoor(world: THREE.Group, scene: THREE.Scene, kind: 'track' | 'snow' | 'sunset' | 'highway'): THREE.Points | null {
  const sky = kind === 'sunset' ? '#f59e5b' : kind === 'snow' ? '#c7d2de' : '#8ec5ff';
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, 60, 220);
  const groundColor = kind === 'snow' ? '#f1f5f9' : kind === 'sunset' ? '#5b4636' : '#4d7c3a';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), mat(groundColor, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);
  world.add(new THREE.HemisphereLight(kind === 'sunset' ? '#ffd2a8' : '#ffffff', groundColor, kind === 'snow' ? 1.2 : 0.8));
  const sun = new THREE.DirectionalLight(kind === 'sunset' ? '#ff9a5a' : '#fff6e0', kind === 'sunset' ? 2.2 : 2);
  sun.position.set(kind === 'sunset' ? -40 : 30, kind === 'sunset' ? 8 : 40, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 150 });
  world.add(sun);
  const asphalt = mat(kind === 'snow' ? '#6b7280' : '#2b2f36', { roughness: 0.95 });
  const white = new THREE.MeshBasicMaterial({ color: '#f8fafc' });
  if (kind === 'track') {
    const road = new THREE.Mesh(new THREE.RingGeometry(26, 34, 128), asphalt);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.01;
    road.receiveShadow = true;
    world.add(road);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 2), white);
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = -a;
      dash.position.set(Math.cos(a) * 30, 0.02, Math.sin(a) * 30);
      world.add(dash);
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 12), mat('#f97316'));
      cone.position.set(Math.cos(a) * 35, 0.4, Math.sin(a) * 35);
      world.add(cone);
    }
    // The hall the truck came out of.
    const hall = box(30, 10, 20, mat('#475569', { roughness: 0.8 }), 0.2);
    hall.position.set(0, 5, 0);
    world.add(hall);
    const door = box(9, 6, 0.2, mat('#0f172a'), 0.02);
    door.position.set(0, 3, 10.05);
    world.add(door);
  } else {
    // A straight road along x through the scene.
    const road = new THREE.Mesh(new THREE.PlaneGeometry(500, 9), asphalt);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.01;
    road.receiveShadow = true;
    world.add(road);
    for (let i = -40; i <= 40; i++) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.18), white);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(i * 6, 0.02, 0);
      world.add(dash);
    }
    if (kind === 'highway') for (const z of [-5.2, 5.2]) {
      const rail = box(500, 0.25, 0.1, mat('#cbd5e1', { metalness: 0.7 }), 0.02);
      rail.position.set(0, 0.7, z);
      world.add(rail);
    }
    // Hills or pines along the road.
    for (let i = 0; i < 40; i++) {
      const x = -180 + i * 9 + (i % 3) * 2;
      const z = (i % 2 ? 1 : -1) * (18 + (i % 5) * 7);
      if (kind === 'snow') {
        const pine = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 10), mat('#1f4d3a', { roughness: 0.9 }));
        pine.position.set(x, 3.5, z);
        pine.castShadow = true;
        world.add(pine);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.2, 10), mat('#f8fafc'));
        cap.position.set(x, 6.4, z);
        world.add(cap);
      } else {
        const hill = new THREE.Mesh(new THREE.SphereGeometry(14 + (i % 4) * 4, 16, 10), mat(kind === 'sunset' ? '#7c4a33' : '#3f6b2f', { roughness: 1 }));
        hill.scale.y = 0.35;
        hill.position.set(x, -2, z * 2.4);
        world.add(hill);
      }
    }
    if (kind === 'sunset') {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(14, 40), new THREE.MeshBasicMaterial({ color: '#ffd166' }));
      disc.position.set(-180, 14, -60);
      disc.lookAt(0, 4, 0);
      world.add(disc);
    }
  }
  if (kind === 'snow') {
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.18, transparent: true, opacity: 0.9 }));
    world.add(snow);
    return snow;
  }
  return null;
}

/** The inside of the cab: dashboard, wheel, seats, bunk and the player's keepsakes. */
function buildInterior(t: BuiltTruck, charms: string[]) {
  const g = new THREE.Group();
  const { frontX, length: cabL, height: cabH, width } = t.cab;
  const trim = mat('#1f2937', { roughness: 0.8, side: THREE.DoubleSide });
  const soft = mat('#334155', { roughness: 0.95, side: THREE.DoubleSide });
  const floorY = 1.15;
  const floor = box(cabL - 0.1, 0.05, width - 0.1, trim, 0.01);
  floor.position.set(frontX - cabL / 2, floorY, 0);
  g.add(floor);
  // Dashboard with a glowing cluster and a screen.
  const dash = box(0.6, 0.55, width - 0.15, mat('#111827', { roughness: 0.6 }), 0.08);
  dash.position.set(frontX - 0.35, floorY + 0.75, 0);
  g.add(dash);
  const cluster = box(0.04, 0.22, 0.55, mat('#0ea5e9', { emissive: new THREE.Color('#0ea5e9'), emissiveIntensity: 0.9 }), 0.02);
  cluster.position.set(frontX - 0.66, floorY + 0.98, -width * 0.22);
  g.add(cluster);
  const screen = box(0.04, 0.2, 0.35, mat('#22c55e', { emissive: new THREE.Color('#16a34a'), emissiveIntensity: 0.7 }), 0.02);
  screen.position.set(frontX - 0.6, floorY + 0.98, 0.15);
  g.add(screen);
  // Steering wheel.
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 10, 32), mat('#0b0f17', { roughness: 0.5 }));
  wheel.position.set(frontX - 0.85, floorY + 0.95, -width * 0.22);
  wheel.rotation.y = Math.PI / 2;
  wheel.rotation.x = 0.35;
  g.add(wheel);
  // Seats.
  for (const z of [-width * 0.22, width * 0.22]) {
    const seat = box(0.55, 0.15, 0.55, soft, 0.06);
    seat.position.set(frontX - 1.25, floorY + 0.5, z);
    const back = box(0.15, 0.8, 0.55, soft, 0.06);
    back.position.set(frontX - 1.55, floorY + 0.95, z);
    g.add(seat, back);
  }
  // Rear wall with the bunk (sleeper cabs).
  const rear = box(0.05, cabH - floorY - 0.1, width - 0.1, trim, 0.01);
  rear.position.set(frontX - cabL + 0.08, floorY + (cabH - floorY) / 2, 0);
  g.add(rear);
  if (cabL > 2) {
    const bunk = box(0.6, 0.18, width - 0.2, mat('#475569', { roughness: 1 }), 0.06);
    bunk.position.set(frontX - cabL + 0.4, floorY + 0.55, 0);
    g.add(bunk);
    const pillow = box(0.35, 0.12, 0.45, mat('#e2e8f0', { roughness: 1 }), 0.05);
    pillow.position.set(frontX - cabL + 0.4, floorY + 0.7, width / 2 - 0.4);
    g.add(pillow);
  }
  // Roof lining and door panels.
  const roof = box(cabL - 0.1, 0.04, width - 0.1, trim, 0.01);
  roof.position.set(frontX - cabL / 2, cabH - 0.1, 0);
  g.add(roof);
  for (const side of [-1, 1]) {
    const panel = box(cabL - 0.3, 0.7, 0.04, soft, 0.02);
    panel.position.set(frontX - cabL / 2, floorY + 0.5, side * (width / 2 - 0.08));
    g.add(panel);
  }
  const front = box(0.05, 1.05, width - 0.1, trim, 0.01);
  front.position.set(frontX - 0.06, floorY + 0.55, 0);
  g.add(front);
  for (const side of [-1, 1]) {
    // Behind the door window: the wall up to the roof.
    const upper = box(cabL * 0.45, cabH - floorY - 0.8, 0.04, trim, 0.01);
    upper.position.set(frontX - cabL + cabL * 0.25, floorY + 0.8 + (cabH - floorY - 0.8) / 2, side * (width / 2 - 0.08));
    g.add(upper);
  }
  // Keepsakes from the inventory.
  const has = (id: string) => charms.includes(id);
  if (has('truck_keychain')) {
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.25, 4), mat('#e5e7eb'));
    string.position.set(frontX - 0.3, cabH - 0.55, 0);
    const toy = box(0.12, 0.07, 0.06, mat('#dc2626'), 0.01);
    toy.position.set(frontX - 0.3, cabH - 0.72, 0);
    g.add(string, toy);
  }
  if (has('road_atlas')) {
    const atlas = box(0.3, 0.03, 0.22, mat('#1d4ed8'), 0.01);
    atlas.position.set(frontX - 0.45, floorY + 1.04, width * 0.25);
    atlas.rotation.y = 0.3;
    g.add(atlas);
  }
  if (has('cb_mic')) {
    const mic = box(0.06, 0.1, 0.04, mat('#111827'), 0.02);
    mic.position.set(frontX - 0.55, cabH - 0.25, width * 0.05);
    g.add(mic);
  }
  if (has('old_tachograph')) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.005, 20), mat('#f8fafc'));
    disc.position.set(frontX - 0.62, floorY + 1.04, width * 0.05);
    g.add(disc);
  }
  if (has('trucker_cap')) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#b91c1c'));
    cap.position.set(frontX - 1.25, floorY + 0.6, width * 0.22);
    g.add(cap);
  }
  if (has('sunglasses')) {
    const glasses = box(0.05, 0.04, 0.16, mat('#0b0f17', { metalness: 0.8 }), 0.01);
    glasses.position.set(frontX - 0.5, floorY + 1.05, -width * 0.05);
    g.add(glasses);
  }
  return g;
}

/** In the cab the outer shell is hidden (the interior has its own walls) and the glass is clear. */
function showShell(t: BuiltTruck | null, on: boolean) {
  t?.group.traverse((o) => {
    if (o.userData.shell) o.visible = on;
    if (o.userData.glass && o instanceof THREE.Mesh) (o.material as THREE.MeshStandardMaterial).opacity = on ? 0.82 : 0.12;
  });
}

function setOrbit(ctx: Ctx, spin: boolean) {
  const { camera, controls, truck } = ctx;
  const len = truck?.length ?? 8;
  const dist = Math.max(12, len * 1.05);
  camera.position.set(dist * 0.75, Math.min(7, dist * 0.32), dist * 0.85);
  controls.enabled = true;
  controls.enableZoom = true;
  controls.minDistance = 5;
  controls.maxDistance = 45;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.target.set(0, 1.8, 0);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  controls.autoRotate = spin && !reduce;
  controls.autoRotateSpeed = 0.7;
  controls.update();
}

function setCab(ctx: Ctx) {
  const { camera, controls, truck, holder } = ctx;
  if (!truck) return;
  const eye = truck.eye.clone();
  holder.localToWorld(eye);
  controls.autoRotate = false;
  controls.enableZoom = false;
  controls.minDistance = 0.01;
  controls.maxDistance = 0.2;
  controls.maxPolarAngle = Math.PI - 0.2;
  controls.target.copy(eye);
  camera.position.set(eye.x - 0.08, eye.y + 0.025, eye.z);
  controls.update();
}

export function GarageScene(props: GarageSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const prevTuning = useRef<Tuning | null>(null);
  const charmsRef = useRef<string[]>(props.charms ?? []);
  const charmsKey = (props.charms ?? []).join(',');
  useEffect(() => {
    charmsRef.current = charmsKey ? charmsKey.split(',') : [];
  }, [charmsKey]);

  // The renderer and the loop live as long as the component.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    const world = new THREE.Group();
    const holder = new THREE.Group();
    holder.position.y = 0.16;
    scene.add(world, holder);
    const ctx: Ctx = { renderer, scene, camera, controls, world, holder, truck: null, interior: null, snow: null, drops: [], drive: null, mode: 'orbit' };
    ctxRef.current = ctx;
    props.onCapture?.(() => {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    });
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Parts drop into place when fitted.
      ctx.drops = ctx.drops.filter((d) => {
        const k = Math.min(1, (now - d.start) / 650);
        const ease = 1 - Math.pow(1 - k, 3);
        d.obj.position.y = d.y + (1 - ease) * 2.2;
        return k < 1;
      });
      if (ctx.snow) {
        const p = ctx.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          let y = p.getY(i) - dt * 2.2;
          if (y < 0) y = 30;
          p.setY(i, y);
        }
        p.needsUpdate = true;
      }
      if (ctx.mode === 'drive' && ctx.drive && ctx.truck) {
        const speed = 9; // m/s
        ctx.drive.angle += (speed * dt) / ctx.drive.radius;
        const a = ctx.drive.angle;
        const r = ctx.drive.radius;
        const pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        const dir = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
        holder.position.copy(pos);
        holder.rotation.y = Math.atan2(-dir.z, dir.x);
        for (const w of ctx.truck.wheels) w.rotation.z -= (speed * dt) / 0.5;
        const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const chase = pos.clone().addScaledVector(dir, -(ctx.truck.length / 2 + 15)).addScaledVector(out, 6).add(new THREE.Vector3(0, 7, 0));
        if (camera.position.distanceTo(chase) > 60) camera.position.copy(chase);
        else camera.position.lerp(chase, 0.12);
        camera.lookAt(pos.x + dir.x * 4, 2.5, pos.z + dir.z * 4);
      } else {
        controls.update();
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      disposeTree(scene);
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      ctxRef.current = null;
      props.onCapture?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const outdoor: 'track' | GarageScenery = props.mode === 'drive' ? 'track' : props.scenery;
  const othersKey = JSON.stringify(props.others ?? []);
  const retiredKey = JSON.stringify(props.retired ?? []);

  // The world around the truck: the hall or an outdoor scene.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    disposeTree(ctx.world);
    ctx.world.clear();
    ctx.snow = null;
    if (outdoor === 'hall') {
      const hall = buildHall(ctx.world, ctx.scene, { tier: props.tier, night: props.night, sign: props.sign, trophies: props.trophies, retired: props.retired ?? [] });
      // The other trucks on side platforms, facing the turntable.
      (props.others ?? []).slice(0, 2).forEach((o, i) => {
        const t = buildTruck({ ...o, night: props.night });
        const side = i === 0 ? -1 : 1;
        t.group.rotation.y = side * (Math.PI / 2);
        t.group.position.set(side * (hall.w / 2 - 4.5), 0.12, 0);
        const pad = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, Math.min(hall.d - 4, t.length + 2)), mat('#273244', { metalness: 0.5, roughness: 0.4 }));
        pad.position.set(side * (hall.w / 2 - 4.5), 0.06, 0);
        ctx.world.add(pad, t.group);
      });
      ctx.holder.position.set(0, 0.16, 0);
      ctx.holder.rotation.set(0, 0, 0);
    } else {
      ctx.snow = buildOutdoor(ctx.world, ctx.scene, outdoor);
      ctx.holder.position.set(0, 0, outdoor === 'track' ? 30 : 2.2);
      ctx.holder.rotation.set(0, 0, 0);
    }
    if (ctx.mode === 'cab') setCab(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outdoor, props.tier, props.night, props.sign, props.trophies, othersKey, retiredKey]);

  const truckKey = JSON.stringify({ ...props.truck, night: props.night });

  // The chosen truck: rebuilt when its looks change; newly fitted parts drop into place.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.truck) {
      disposeTree(ctx.truck.group);
      ctx.holder.remove(ctx.truck.group);
    }
    if (ctx.interior) {
      disposeTree(ctx.interior);
      ctx.holder.remove(ctx.interior);
      ctx.interior = null;
    }
    const built = buildTruck({ ...props.truck, night: props.night });
    ctx.holder.add(built.group);
    ctx.truck = built;
    const tuning = props.truck.tuning ?? props.truck.cosmetics?.tuning ?? {};
    const before = prevTuning.current;
    if (before) {
      const now = performance.now();
      for (const [part, objs] of built.parts) {
        if ((before as Record<string, string | undefined>)[part] !== (tuning as Record<string, string | undefined>)[part]) for (const o of objs) ctx.drops.push({ obj: o, y: o.position.y, start: now });
      }
    }
    prevTuning.current = { ...tuning };
    if (ctx.mode === 'cab') {
      ctx.interior = buildInterior(built, charmsRef.current);
      ctx.holder.add(ctx.interior);
      showShell(built, false);
      setCab(ctx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckKey]);

  // Camera mode.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.mode = props.mode;
    showShell(ctx.truck, props.mode !== 'cab');
    if (ctx.interior) {
      disposeTree(ctx.interior);
      ctx.holder.remove(ctx.interior);
      ctx.interior = null;
    }
    if (props.mode === 'drive') {
      ctx.drive = { angle: Math.PI / 2, radius: 30 };
      ctx.controls.enabled = false;
      ctx.controls.autoRotate = false;
      return;
    }
    ctx.drive = null;
    if (props.mode === 'cab' && ctx.truck) {
      ctx.interior = buildInterior(ctx.truck, charmsRef.current);
      ctx.holder.add(ctx.interior);
      setCab(ctx);
    } else {
      setOrbit(ctx, props.spin && props.scenery === 'hall');
    }
  }, [props.mode, props.spin, props.scenery]);

  return <div ref={host} className="h-full w-full touch-none" data-testid="garage-3d" />;
}
