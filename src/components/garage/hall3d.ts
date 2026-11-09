/**
 * 1.2.3.5: the garage hall and the outdoor scenes.
 *
 * The hall is an industrial workshop: a polished concrete floor with painted bays
 * (and a real reflection on desktop), block walls with steel cladding, I-beam columns,
 * roof trusses with high-bay lamps, a sectional door, tool cabinets, a tyre rack,
 * drums, a trophy cabinet, the retro shelf and a neon sign. Outside: a physical sky,
 * textured ground, a test track, a highway, snow or a sunset.
 */
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { asphaltTexture, concreteTexture, corrugatedNormal, groundTexture, treadTexture } from './textures';
import { box, buildTruck } from './truck3d';

export const HALLS: Record<number, { w: number; d: number; h: number }> = { 1: { w: 30, d: 24, h: 8 }, 2: { w: 38, d: 28, h: 10 }, 3: { w: 48, d: 32, h: 12 } };

/** Sets a position and returns the object (three's position is read-only). */
function place<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

const steelBlue = () => new THREE.MeshStandardMaterial({ color: '#3b4a5c', roughness: 0.55, metalness: 0.6 });

function neonSign(text: string, night: boolean) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.font = 'bold 110px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#22d3ee';
  g.shadowBlur = night ? 40 : 22;
  g.fillStyle = '#cffafe';
  g.fillText(text.slice(0, 18).toUpperCase(), 512, 96);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), m);
}

/** A stack of tyres or one on a rack, with tread. */
function tyre(r = 0.53) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(r * 0.78, r * 0.24, 14, 36), new THREE.MeshStandardMaterial({ color: '#1a1c20', roughness: 0.9, map: treadTexture() }));
  t.castShadow = true;
  t.receiveShadow = true;
  return t;
}

function drum(color: string) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 24), new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 }));
  body.position.y = 0.44;
  body.castShadow = true;
  g.add(body);
  for (const y of [0.25, 0.63]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.305, 0.015, 6, 24), new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  return g;
}

function toolCabinet() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: '#b91c1c', roughness: 0.35, metalness: 0.4 });
  g.add(place(box(1.6, 1.0, 0.6, red, 0.03), 0, 0.6, 0));
  for (let i = 0; i < 5; i++) {
    const line = box(1.5, 0.015, 0.01, new THREE.MeshStandardMaterial({ color: '#450a0a' }), 0.002);
    line.position.set(0, 0.2 + i * 0.2, 0.305);
    g.add(line);
    const handle = box(0.4, 0.025, 0.03, new THREE.MeshStandardMaterial({ color: '#e5e7eb', metalness: 1, roughness: 0.2 }), 0.01);
    handle.position.set(0, 0.28 + i * 0.2, 0.32);
    g.add(handle);
  }
  const top = box(1.65, 0.05, 0.65, new THREE.MeshStandardMaterial({ color: '#9ca3af', metalness: 0.8, roughness: 0.3 }), 0.01);
  top.position.y = 1.12;
  g.add(top);
  for (const x of [-0.7, 0.7]) for (const z of [-0.22, 0.22]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), new THREE.MeshStandardMaterial({ color: '#111' }));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.05, z);
    g.add(w);
  }
  return g;
}

export interface HallOptions {
  tier: number;
  night: boolean;
  sign: string;
  trophies: number;
  retired: { modelId: string; color: string }[];
  /** Desktop: a real reflection in the floor. */
  high: boolean;
}

/** Builds the hall into `world`; returns its size. */
export function buildHall(world: THREE.Group, scene: THREE.Scene, p: HallOptions) {
  const { w, d, h } = HALLS[p.tier] ?? HALLS[1]!;
  scene.background = new THREE.Color(p.night ? '#04060a' : '#0b111a');
  scene.fog = null;

  // Floor: polished concrete (with a reflection under a slightly see-through floor on desktop).
  const conc = concreteTexture(p.tier === 3 ? 104 : 92).clone();
  conc.needsUpdate = true;
  conc.repeat.set(w / 8, d / 8);
  if (p.high) {
    const mirror = new Reflector(new THREE.PlaneGeometry(w, d), { textureWidth: 1024, textureHeight: 1024, color: new THREE.Color('#5d6673') });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -0.005;
    world.add(mirror);
  }
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ map: conc, roughness: 0.42, metalness: 0.05, transparent: p.high, opacity: p.high ? 0.86 : 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  world.add(floor);
  // Painted bays and walkways.
  const yellow = new THREE.MeshStandardMaterial({ color: '#eab308', roughness: 0.5 });
  const line = (x: number, z: number, lw: number, ld: number) => {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(lw, ld), yellow);
    l.rotation.x = -Math.PI / 2;
    l.position.set(x, 0.004, z);
    l.receiveShadow = true;
    world.add(l);
  };
  for (const side of [-1, 1]) {
    line(side * (w / 2 - 9), 0, 0.12, d - 4);
    line(side * 12, 0, 0.12, d - 6);
  }
  line(0, d / 2 - 3, w - 6, 0.12);
  line(0, -d / 2 + 3, w - 6, 0.12);

  // Walls: concrete blocks below, ribbed steel above, facing inward (invisible from outside).
  const block = new THREE.MeshStandardMaterial({ color: '#8b929b', roughness: 0.9, map: concreteTexture(130) });
  const clad = new THREE.MeshStandardMaterial({ color: p.tier === 3 ? '#cfd6de' : '#a9b2bd', roughness: 0.45, metalness: 0.55, normalMap: corrugatedNormal(30) });
  clad.normalMap = clad.normalMap!.clone();
  clad.normalMap.needsUpdate = true;
  clad.normalMap.wrapS = THREE.RepeatWrapping;
  clad.normalMap.repeat.set(w / 4, 1);
  const walls: [number, number, number, number][] = [
    [w, 0, -d / 2, 0],
    [w, 0, d / 2, Math.PI],
    [d, -w / 2, 0, Math.PI / 2],
    [d, w / 2, 0, -Math.PI / 2],
  ];
  for (const [len, x, z, ry] of walls) {
    const low = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.4), block);
    low.position.set(x, 0.7, z);
    low.rotation.y = ry;
    low.receiveShadow = true;
    world.add(low);
    const up = new THREE.Mesh(new THREE.PlaneGeometry(len, h - 1.4), clad);
    up.position.set(x, 1.4 + (h - 1.4) / 2, z);
    up.rotation.y = ry;
    up.receiveShadow = true;
    world.add(up);
  }
  // Translucent light strip high on the side walls: daylight or the night sky.
  const strip = new THREE.MeshStandardMaterial({ color: p.night ? '#0a1424' : '#dbeafe', emissive: new THREE.Color(p.night ? '#0a1424' : '#e0f2fe'), emissiveIntensity: p.night ? 0.3 : 1.4, toneMapped: true });
  for (const side of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(d - 2, 1.3), strip);
    s.position.set(side * (w / 2 - 0.03), h - 1.4, 0);
    s.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    world.add(s);
  }
  // Roof: dark panels on steel trusses with purlins; I-beam columns along the walls.
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: '#2a313b', roughness: 0.9, normalMap: corrugatedNormal(40), side: THREE.DoubleSide }));
  roof.rotation.x = Math.PI / 2;
  roof.position.y = h;
  world.add(roof);
  const beam = steelBlue();
  const bays = Math.round(w / 6);
  for (let i = 0; i <= bays; i++) {
    const x = -w / 2 + (i * w) / bays;
    for (const side of [-1, 1]) {
      const z = side * (d / 2 - 0.25);
      world.add(place(box(0.3, h, 0.04, beam, 0.005), x, h / 2, z - side * 0.13));
      world.add(place(box(0.3, h, 0.04, beam, 0.005), x, h / 2, z + side * 0.13));
      world.add(place(box(0.04, h, 0.26, beam, 0.005), x, h / 2, z));
    }
    // A truss across the hall: bottom chord, top chord and diagonals.
    world.add(place(box(0.12, 0.12, d, beam, 0.01), x, h - 1.4, 0));
    world.add(place(box(0.12, 0.12, d, beam, 0.01), x, h - 0.15, 0));
    const n = 10;
    for (let k = 0; k < n; k++) {
      const z0 = -d / 2 + (k * d) / n;
      const diag = box(0.06, Math.hypot(d / n, 1.25), 0.06, beam, 0.005);
      diag.rotation.x = (k % 2 ? 1 : -1) * Math.atan2(d / n, 1.25);
      diag.position.set(x, h - 0.78, z0 + d / n / 2);
      world.add(diag);
    }
    // High-bay lamps hanging from every other truss.
    if (i % 2 === 1 && i < bays) for (const z of [-d / 4, d / 4]) {
      const lamp = new THREE.Group();
      const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.55, 0.45, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }));
      lamp.add(dome);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: '#fff7e0', toneMapped: false }));
      disc.rotation.x = Math.PI / 2;
      disc.position.y = -0.22;
      lamp.add(disc);
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.2, 4), new THREE.MeshStandardMaterial({ color: '#111' }));
      cable.position.y = 0.8;
      lamp.add(cable);
      lamp.position.set(x, h - 2.2, z);
      world.add(lamp);
    }
  }
  for (let k = 0; k < 6; k++) world.add(place(box(w, 0.1, 0.1, beam, 0.01), 0, h - 0.1, -d / 2 + ((k + 0.5) * d) / 6));

  // Sectional door on the back wall with a row of windows, hazard posts beside it.
  const doorW = 6;
  const doorH = 5.5;
  const dx = -w / 4;
  const doorM = new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.4, metalness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const panel = box(doorW, doorH / 6 - 0.03, 0.08, doorM, 0.02);
    panel.position.set(dx, doorH / 12 + (i * doorH) / 6, -d / 2 + 0.06);
    world.add(panel);
    if (i === 4) for (let k = 0; k < 5; k++) {
      const win = box(0.9, 0.42, 0.02, new THREE.MeshStandardMaterial({ color: p.night ? '#0a1424' : '#bfdbfe', emissive: new THREE.Color(p.night ? '#0a1424' : '#bfdbfe'), emissiveIntensity: p.night ? 0.2 : 0.9 }), 0.03);
      win.position.set(dx - 2.4 + k * 1.2, doorH / 12 + (i * doorH) / 6, -d / 2 + 0.11);
      world.add(win);
    }
  }
  for (const side of [-1, 1]) {
    const post = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 16), new THREE.MeshStandardMaterial({ color: k % 2 ? '#111' : '#eab308', roughness: 0.5 }));
      seg.position.y = 0.1 + k * 0.2;
      post.add(seg);
    }
    post.position.set(dx + side * (doorW / 2 + 0.4), 0, -d / 2 + 0.5);
    world.add(post);
  }

  // Neon sign with the player's name over the workshop corner.
  const sign = neonSign(p.sign, p.night);
  sign.position.set(w / 6, h - 3.2, -d / 2 + 0.08);
  world.add(sign);
  // Workshop corner: tool cabinets, a workbench with a pegboard, drums, an extinguisher.
  for (let i = 0; i < 3; i++) {
    const cab = toolCabinet();
    cab.position.set(w / 6 - 2.2 + i * 1.75, 0, -d / 2 + 0.55);
    world.add(cab);
  }
  const peg = box(5.5, 2.2, 0.05, new THREE.MeshStandardMaterial({ color: '#57534e', roughness: 0.9 }), 0.01);
  peg.position.set(w / 6, 2.6, -d / 2 + 0.06);
  world.add(peg);
  for (let i = 0; i < 12; i++) {
    const tool = box(0.06, 0.35 + (i % 4) * 0.12, 0.04, new THREE.MeshStandardMaterial({ color: i % 3 === 0 ? '#dc2626' : '#d1d5db', metalness: 0.8, roughness: 0.3 }), 0.01);
    tool.position.set(w / 6 - 2.4 + i * 0.44, 2.75 - (i % 2) * 0.35, -d / 2 + 0.12);
    tool.rotation.z = ((i % 3) - 1) * 0.25;
    world.add(tool);
  }
  ['#1d4ed8', '#b91c1c', '#1d4ed8', '#15803d'].forEach((c, i) => {
    const dr = drum(c);
    dr.position.set(w / 2 - 1.2 - (i % 2) * 0.7, 0, -d / 2 + 1.2 + Math.floor(i / 2) * 0.7);
    world.add(dr);
  });
  const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 16), new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.3 }));
  ext.position.set(w / 6 + 3.2, 1.3, -d / 2 + 0.15);
  world.add(ext);

  // Tyre rack on the left wall.
  const rackM = new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.5, metalness: 0.4 });
  for (let level = 0; level < 3; level++) {
    world.add(place(box(0.08, 0.08, 7, rackM, 0.01), -w / 2 + 0.25, 0.35 + level * 1.35, -d / 4));
    world.add(place(box(0.08, 0.08, 7, rackM, 0.01), -w / 2 + 1.0, 0.35 + level * 1.35, -d / 4));
    for (let i = 0; i < 6; i++) {
      const t = tyre();
      t.rotation.y = Math.PI / 2;
      t.position.set(-w / 2 + 0.62, 0.35 + level * 1.35 + 0.55, -d / 4 - 2.9 + i * 1.15);
      world.add(t);
    }
  }
  for (const z of [-d / 4 - 3.5, -d / 4 + 3.5]) for (const x of [-w / 2 + 0.25, -w / 2 + 1.0]) world.add(place(box(0.08, 4, 0.08, rackM, 0.01), x, 2, z));

  // Trophy cabinet (glass, lit) with a cup for each badge.
  const cabX = w / 2 - 0.6;
  const cabZ = d / 6;
  world.add(place(box(0.9, 2.4, 4.2, new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.6 }), 0.03), cabX + 0.05, 1.2, cabZ));
  const glassFront = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.2), new THREE.MeshPhysicalMaterial({ color: '#e0f2fe', roughness: 0.02, transparent: true, opacity: 0.18, clearcoat: 1 }));
  glassFront.rotation.y = -Math.PI / 2;
  glassFront.position.set(cabX - 0.42, 1.25, cabZ);
  world.add(glassFront);
  const glow = new THREE.PointLight('#fff1c1', 4, 3);
  glow.position.set(cabX - 0.2, 2.2, cabZ);
  world.add(glow);
  const gold = new THREE.MeshStandardMaterial({ color: '#eab308', metalness: 1, roughness: 0.18 });
  for (const y of [0.55, 1.6]) world.add(place(box(0.7, 0.03, 4.0, new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.2, metalness: 0.6 }), 0.005), cabX - 0.05, y, cabZ));
  for (let i = 0; i < Math.min(12, p.trophies); i++) {
    const cup = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.07, 16), new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.4 }));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.14, 10), gold);
    stem.position.y = 0.1;
    const bowl = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.02, 0), new THREE.Vector2(0.11, 0.05), new THREE.Vector2(0.13, 0.18), new THREE.Vector2(0.12, 0.2)], 24), gold);
    bowl.position.y = 0.16;
    cup.add(base, stem, bowl);
    cup.position.set(cabX - 0.1, (i < 6 ? 0.57 : 1.62) + 0.03, cabZ - 1.6 + (i % 6) * 0.64);
    world.add(cup);
  }
  // Retro shelf with the player's old trucks as models.
  if (p.retired.length) {
    world.add(place(box(0.55, 0.05, 6.5, new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.7 }), 0.01), w / 2 - 0.35, 3.3, -d / 4));
    p.retired.slice(0, 8).forEach((r, i) => {
      const mini = buildTruck({ modelId: r.modelId, color: r.color, condition: 100 });
      mini.group.scale.setScalar(0.07);
      mini.group.rotation.y = -Math.PI / 2;
      mini.group.position.set(w / 2 - 0.35, 3.33, -d / 4 - 2.8 + i * 0.8);
      world.add(mini.group);
    });
  }
  // A two-post lift (from tier 2); LED lines and a glass office (tier 3).
  if (p.tier >= 2) {
    // In front of the roller door: the truck drives in over it.
    const red = new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.4, metalness: 0.5 });
    const lx = -w / 4;
    const lz = -d / 2 + 3.4;
    for (const dx of [-1.9, 1.9]) {
      world.add(place(box(0.4, 4.2, 0.4, red, 0.04), lx + dx, 2.1, lz));
      for (const dz of [-0.7, 0.7]) world.add(place(box(0.18, 0.1, 1.3, new THREE.MeshStandardMaterial({ color: '#374151', metalness: 0.7, roughness: 0.4 }), 0.02), lx + dx * 0.72, 0.5, lz + dz));
    }
    world.add(place(box(4.1, 0.3, 0.3, red, 0.03), lx, 4.3, lz));
  }
  if (p.tier >= 3) {
    const led = new THREE.MeshBasicMaterial({ color: '#67e8f9', toneMapped: false });
    for (const side of [-1, 1]) world.add(place(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, d * 0.9), led), side * (w / 2 - 0.1), 1.45, 0));
    // Glass office on the front right.
    const office = new THREE.Group();
    office.add(place(box(6, 0.1, 4, new THREE.MeshStandardMaterial({ color: '#334155' }), 0.01), 0, 3, 0));
    for (const [x, z, ww, ry] of [[-3, 0, 4, Math.PI / 2], [0, -2, 6, 0]] as const) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(ww, 2.9), new THREE.MeshPhysicalMaterial({ color: '#cbd5e1', roughness: 0.05, transparent: true, opacity: 0.22, side: THREE.DoubleSide }));
      pane.position.set(x, 1.45, z);
      pane.rotation.y = ry;
      office.add(pane);
    }
    const desk = box(2, 0.75, 0.9, new THREE.MeshStandardMaterial({ color: '#e7e5e4', roughness: 0.6 }), 0.03);
    desk.position.set(0, 0.38, 0.6);
    office.add(desk);
    const screenM = new THREE.MeshBasicMaterial({ color: '#38bdf8', toneMapped: false });
    office.add(place(new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.45), screenM), 0, 1.1, 0.25));
    office.position.set(w / 2 - 4, 0, d / 2 - 3);
    world.add(office);
  }
  // The turntable: brushed steel with an LED edge.
  const table = new THREE.Mesh(new THREE.CylinderGeometry(10, 10.1, 0.16, 96), new THREE.MeshStandardMaterial({ color: '#2a2f37', metalness: 0.85, roughness: 0.35 }));
  table.position.y = 0.08;
  table.receiveShadow = true;
  world.add(table);
  for (const r of [3.5, 7]) {
    const groove = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.03, 96), new THREE.MeshStandardMaterial({ color: '#111418', roughness: 0.8 }));
    groove.rotation.x = -Math.PI / 2;
    groove.position.y = 0.161;
    world.add(groove);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(10.05, 0.05, 8, 128), new THREE.MeshBasicMaterial({ color: '#22d3ee', toneMapped: false }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.15;
  world.add(ring);

  // Light: soft fill from the room, the lamps, and a key light that casts the shadows.
  world.add(new THREE.HemisphereLight(p.night ? '#3b4a6b' : '#dbe4ef', '#20242b', p.night ? 0.35 : 0.6));
  const key = new THREE.DirectionalLight(p.night ? '#c7d2fe' : '#fff4e0', p.night ? 0.9 : 1.6);
  key.position.set(6, h + 8, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(p.high ? 4096 : 2048, p.high ? 4096 : 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
  world.add(key);
  const spots = 2 + p.tier;
  for (let i = 0; i < spots; i++) {
    const a = (i / spots) * Math.PI * 2 + 0.4;
    const spot = new THREE.SpotLight(p.night ? '#ffe7c2' : '#ffffff', p.night ? 160 : 90, h * 2.4, 0.55, 0.7, 1.6);
    spot.position.set(Math.cos(a) * 9, h - 1.5, Math.sin(a) * 7);
    spot.target.position.set(0, 0.8, 0);
    world.add(spot, spot.target);
  }
  return { w, d, h };
}

/** Outdoor scenes for photos and the test drive, under a physical sky. */
export function buildOutdoor(world: THREE.Group, scene: THREE.Scene, kind: 'track' | 'snow' | 'sunset' | 'highway', pmrem: THREE.PMREMGenerator): { snow: THREE.Points | null; env: THREE.Texture } {
  const sky = new Sky();
  sky.scale.setScalar(4500);
  const u = sky.material.uniforms as Record<string, { value: unknown }>;
  const elevation = kind === 'sunset' ? 2.5 : kind === 'snow' ? 18 : 38;
  const azimuth = kind === 'sunset' ? -110 : 140;
  u.turbidity!.value = kind === 'snow' ? 14 : kind === 'sunset' ? 5 : 2.5;
  u.rayleigh!.value = kind === 'snow' ? 0.6 : kind === 'sunset' ? 2.6 : 1.4;
  u.mieCoefficient!.value = kind === 'snow' ? 0.02 : 0.003;
  u.mieDirectionalG!.value = 0.8;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
  (u.sunPosition!.value as THREE.Vector3).copy(sunDir);
  // Reflections come from the same sky.
  const skyScene = new THREE.Scene();
  skyScene.add(sky.clone());
  const env = pmrem.fromScene(skyScene).texture;
  world.add(sky);
  scene.background = null;
  const fogColor = kind === 'sunset' ? '#e9a27a' : kind === 'snow' ? '#d6dde5' : '#b9d3ea';
  scene.fog = new THREE.Fog(fogColor, kind === 'snow' ? 70 : 160, kind === 'snow' ? 260 : 700);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ map: groundTexture(kind === 'snow' ? 'snow' : kind === 'sunset' ? 'dirt' : 'grass'), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);
  world.add(new THREE.HemisphereLight(kind === 'sunset' ? '#ffd2a8' : '#cfe0ff', kind === 'snow' ? '#c9ced6' : '#3d4a30', kind === 'snow' ? 0.6 : 0.35));
  const sun = new THREE.DirectionalLight(kind === 'sunset' ? '#ffb27a' : '#fff6e5', kind === 'sunset' ? 2.6 : kind === 'snow' ? 1.2 : 2.6);
  sun.position.copy(sunDir).multiplyScalar(80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 });
  world.add(sun);
  world.add(sun.target);

  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: kind === 'snow' ? 0.6 : 0.92, color: kind === 'snow' ? '#a3a8b0' : '#ffffff' });
  const white = new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.6 });
  if (kind === 'track') {
    const road = new THREE.Mesh(new THREE.RingGeometry(25, 35, 160, 1), asphalt);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.01;
    road.receiveShadow = true;
    world.add(road);
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 2.2), white);
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = -a;
      dash.position.set(Math.cos(a) * 30, 0.02, Math.sin(a) * 30);
      world.add(dash);
      // Red and white kerbs on both edges.
      for (const r of [24.6, 35.4]) {
        const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, (2 * Math.PI * r) / 64), new THREE.MeshStandardMaterial({ color: i % 2 ? '#dc2626' : '#f8fafc', roughness: 0.6 }));
        kerb.position.set(Math.cos(a) * r, 0.04, Math.sin(a) * r);
        kerb.rotation.y = -a;
        world.add(kerb);
      }
    }
    // The hall the truck came out of, from outside.
    const clad = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.5, metalness: 0.5, normalMap: corrugatedNormal(30) });
    clad.normalMap = clad.normalMap!.clone();
    clad.normalMap.needsUpdate = true;
    clad.normalMap.wrapS = THREE.RepeatWrapping;
    clad.normalMap.repeat.set(8, 1);
    const hall = box(32, 10, 20, clad, 0.05);
    hall.position.set(0, 5, 0);
    world.add(hall);
    const roofM = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.8 });
    const roofG = new THREE.Mesh(new THREE.CylinderGeometry(10.5, 10.5, 32.4, 3, 1), roofM);
    roofG.rotation.z = Math.PI / 2;
    roofG.scale.set(1, 1, 0.22);
    roofG.position.set(0, 10, 0);
    world.add(roofG);
    const door = box(7, 6, 0.2, new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.4, metalness: 0.4 }), 0.03);
    door.position.set(0, 3, 10.05);
    world.add(door);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 16), new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.5 }));
      cone.position.set(Math.cos(a) * 36.4, 0.35, Math.sin(a) * 36.4);
      cone.castShadow = true;
      world.add(cone);
    }
  } else {
    const road = new THREE.Mesh(new THREE.PlaneGeometry(1200, kind === 'highway' ? 16 : 8), asphalt);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.01;
    road.receiveShadow = true;
    world.add(road);
    const lanes = kind === 'highway' ? [-4, 0, 4] : [0];
    for (const z of lanes) for (let i = -60; i <= 60; i++) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.15), white);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(i * 10, 0.02, z);
      world.add(dash);
    }
    for (const z of kind === 'highway' ? [-7.8, 7.8] : [-3.85, 3.85]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(1200, 0.2), white);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(0, 0.02, z);
      world.add(edge);
    }
    if (kind === 'highway') {
      for (const z of [-8.6, 8.6]) {
        // 1.2.3.6: the barrier in 12 m sections (one 1200 m beam showed through the truck as two white lines).
        const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 0.32, 0.06), new THREE.MeshStandardMaterial({ color: '#d1d5db', metalness: 0.9, roughness: 0.3 }), 50);
        const m = new THREE.Matrix4();
        for (let k = 0; k < 50; k++) rails.setMatrixAt(k, m.makeTranslation(-300 + 6 + k * 12, 0.7, z));
        rails.instanceMatrix.needsUpdate = true;
        world.add(rails);
        for (let x = -300; x <= 300; x += 4) world.add(place(box(0.12, 0.75, 0.12, new THREE.MeshStandardMaterial({ color: '#6b7280', metalness: 0.7 }), 0.01), x, 0.38, z + Math.sign(z) * 0.1));
        for (let x = -300; x <= 300; x += 40) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 10, 10), new THREE.MeshStandardMaterial({ color: '#9ca3af', metalness: 0.8, roughness: 0.4 }));
          pole.position.set(x, 5, z + Math.sign(z) * 1.2);
          world.add(pole);
          const arm = box(2.4, 0.12, 0.12, new THREE.MeshStandardMaterial({ color: '#9ca3af', metalness: 0.8 }), 0.02);
          arm.rotation.y = Math.PI / 2;
          arm.position.set(x, 10, z + Math.sign(z) * 0.1);
          world.add(arm);
        }
      }
    }
    // Trees and distant mountains.
    const r = (i: number) => (Math.sin(i * 12.9898) * 43758.5453) % 1;
    for (let i = 0; i < 90; i++) {
      const x = -300 + i * 6.7 + Math.abs(r(i)) * 4;
      const z = (i % 2 ? 1 : -1) * (16 + Math.abs(r(i + 3)) * 60);
      if (kind === 'snow' || i % 3 === 0) {
        const pine = new THREE.Group();
        for (let k = 0; k < 3; k++) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(2.4 - k * 0.6, 3.2, 12), new THREE.MeshStandardMaterial({ color: kind === 'snow' ? (k === 2 ? '#f1f5f9' : '#2f4f3e') : '#1f4d34', roughness: 0.9 }));
          c.position.y = 2.6 + k * 1.6;
          c.castShadow = true;
          pine.add(c);
        }
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 2, 8), new THREE.MeshStandardMaterial({ color: '#4a3424' }));
        trunk.position.y = 1;
        pine.add(trunk);
        pine.position.set(x, 0, z);
        pine.scale.setScalar(0.8 + Math.abs(r(i + 7)) * 0.6);
        world.add(pine);
      } else {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 3, 8), new THREE.MeshStandardMaterial({ color: '#4a3424' }));
        trunk.position.y = 1.5;
        tree.add(trunk);
        for (let k = 0; k < 4; k++) {
          const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6 + Math.abs(r(i + k)) * 0.8, 1), new THREE.MeshStandardMaterial({ color: kind === 'sunset' ? '#7c5a2a' : '#3f6b2a', roughness: 0.9, flatShading: true }));
          leaf.position.set((k - 1.5) * 0.7, 3.8 + (k % 2) * 0.8, (k % 2) * 0.6);
          leaf.castShadow = true;
          tree.add(leaf);
        }
        tree.position.set(x, 0, z);
        world.add(tree);
      }
    }
    for (let i = 0; i < 14; i++) {
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(60 + (i % 4) * 25, 50 + (i % 3) * 30, 7), new THREE.MeshStandardMaterial({ color: kind === 'sunset' ? '#5b3a3a' : '#5d6b78', roughness: 1, flatShading: true }));
      mtn.position.set(-500 + i * 80, 20, -380 - (i % 3) * 60);
      world.add(mtn);
      if (kind !== 'sunset') {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(22 + (i % 4) * 8, 18 + (i % 3) * 10, 7), new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 1, flatShading: true }));
        cap.position.set(-500 + i * 80, 45 + (i % 3) * 15 - 4, -380 - (i % 3) * 60);
        world.add(cap);
      }
    }
  }
  let snow: THREE.Points | null = null;
  if (kind === 'snow') {
    const n = 3000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.12, transparent: true, opacity: 0.85 }));
    world.add(snow);
  }
  return { snow, env };
}
